"""SQLite aislado e inyección de conflictos posteriores a la validación.

No prueba concurrencia PostgreSQL; H05 simultáneo queda pendiente.
"""
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_seguridad_csrf as s
from django.db import IntegrityError
from usuarios.models.rol_model import Permiso, RolPermiso
from APIs.servicios.conflictos_unicidad import campo_duplicado
from APIs.obras_sociales.services.obra_social_service import ObraSocialService


class IntegridadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        for nombre in ('profesionales.crear','profesionales.edit','obras_sociales.edit'):
            permiso=Permiso.objects.create(permiso=nombre,descripcion='Ficticio')
            RolPermiso.objects.create(rol=self.f.roles['Administrador'],permiso=permiso)
        self.admin = self.f.login('admin')
        s.Profesional.objects.filter(pk=self.f.profesionales['A'].pk).update(dni='12345678')
        self.f.profesionales['A'].refresh_from_db()

    def enviar(self, datos, url='/api/profesionales/', metodo='post', cliente=None):
        c = cliente or self.admin
        return getattr(c,metodo)(url,datos,content_type='application/json',HTTP_X_CSRFTOKEN=self.f.token(c))

    def datos(self):
        return dict(nombre='Nuevo',apellido='Ficticio',dni='34567890',matricula='NUEVA',
            especialidad=self.f.profesionales['A'].especialidad_id,rol=self.f.roles['Profesional'].pk,
            usuario='prof_ficticio',password='ClaveFicticia123')

    def test_alta_valida_y_duplicados_preventivos(self):
        for campo,valor in [('dni','12345678'),('matricula',self.f.profesionales['A'].matricula),
                            ('usuario',self.f.usuarios['A'].usuario)]:
            antes=self.f.snapshot()
            r=self.enviar({**self.datos(),campo:valor})
            self.assertEqual(r.status_code,400,r.content)
            self.assertIn(campo,r.json())
            self.assertEqual(self.f.snapshot(),antes)
        self.assertEqual(self.enviar(self.datos()).status_code,201)

    def test_alta_conflicto_real_despues_de_validar_y_rollback_usuario(self):
        for campo in ('dni','matricula','usuario'):
            antes=self.f.snapshot()
            crear=s.Profesional.objects.create
            def colision(**datos):
                datos[campo]=getattr(self.f.profesionales['A'],campo)
                return crear(**datos)
            with patch.object(s.Profesional.objects,'create',side_effect=colision):
                r=self.enviar(self.datos())
            self.assertEqual(r.status_code,400,r.content)
            self.assertIn(campo,r.json())
            self.assertEqual(self.f.snapshot(),antes)
            self.assertFalse(s.Usuario.objects.filter(usuario='prof_ficticio').exists())

    def test_usuario_colision_despues_del_exists(self):
        antes=self.f.snapshot()
        crear=s.Usuario.objects.create
        def colision(**datos):
            datos['usuario']=self.f.usuarios['A'].usuario
            return crear(**datos)
        with patch.object(s.Usuario.objects,'create',side_effect=colision):
            r=self.enviar(self.datos())
        self.assertEqual(r.status_code,400,r.content)
        self.assertIn('usuario',r.json())
        self.assertEqual(self.f.snapshot(),antes)

    def test_edicion_profesional_colisiones_revierten_usuario(self):
        url=f'/api/profesionales/{self.f.profesionales["B"].pk}/'
        for campo in ('dni','matricula','usuario'):
            antes=self.f.snapshot()
            modelo=s.Usuario if campo=='usuario' else s.Profesional
            guardar=modelo.save
            def colision(instancia,*args,**kwargs):
                setattr(instancia,campo,getattr(self.f.usuarios['A'] if campo=='usuario' else self.f.profesionales['A'],campo))
                return guardar(instancia,*args,**kwargs)
            with patch.object(modelo,'save',colision):
                r=self.enviar({'usuario':'nombre_nuevo', 'dni':'34567890','matricula':'NUEVA'},url,'patch')
            self.assertEqual(r.status_code,400,r.content)
            self.assertIn(campo,r.json())
            self.assertEqual(self.f.snapshot(),antes)

    def test_tutor_dni_preventivo_y_conflicto_al_guardar(self):
        otro=s.Tutor.objects.create(nombre='Otro',apellido='Ficticio',dni='12345678')
        url=f'/api/tutores/{self.f.tutor.pk}/'
        cliente=self.f.login('B')
        antes=self.f.snapshot()
        r=self.enviar({'dni':otro.dni},url,'patch',cliente)
        self.assertEqual(r.status_code,400,r.content)
        guardar=s.Tutor.save
        def colision(instancia,*args,**kwargs):
            instancia.dni=otro.dni
            return guardar(instancia,*args,**kwargs)
        with patch.object(s.Tutor,'save',colision):
            r=self.enviar({'dni':'34567890'},url,'patch',cliente)
        self.assertEqual(r.status_code,400,r.content)
        self.assertIn('dni',r.json())
        self.assertEqual(self.f.snapshot(),antes)

    def test_integridad_desconocida_no_se_oculta(self):
        antes=self.f.snapshot()
        with patch.object(s.Profesional.objects,'create',side_effect=IntegrityError('inesperado')):
            with self.assertRaises(IntegrityError):
                self.enviar(self.datos())
        self.assertEqual(self.f.snapshot(),antes)

    def test_diagnostico_postgresql_solo_unicidad_especifica(self):
        campos=[(s.Profesional,'dni','dni','Duplicado')]
        causa=Exception('no revelar detalle')
        causa.sqlstate='23505'
        causa.diag=SimpleNamespace(table_name='profesionales',constraint_name='indice_real')
        error=IntegrityError('no revelar SQL');error.__cause__=causa
        with patch('APIs.servicios.conflictos_unicidad.connection') as conexion:
            conexion.vendor='postgresql'
            conexion.introspection.get_constraints.return_value={
                'indice_real':{'unique':True,'primary_key':False,'columns':['DNI']}}
            self.assertEqual(campo_duplicado(error,campos),('dni','Duplicado'))
            for codigo in ('23503','23502','23514',None):
                causa.sqlstate=codigo
                self.assertIsNone(campo_duplicado(error,campos))
            causa.sqlstate='23505'
            conexion.introspection.get_constraints.return_value={
                'indice_real':{'unique':True,'columns':['OtraColumna']}}
            self.assertIsNone(campo_duplicado(error,campos))

    def test_h05_normalizacion_actual_sin_reglas_nuevas(self):
        normalizar=ObraSocialService.normalizar_nombre
        self.assertEqual(normalizar('  ÓSDE  '),normalizar('osde'))
        self.assertNotEqual(normalizar('Obra  Social'),normalizar('Obra Social'))

    def test_h05_duplicados_secuenciales_alta_y_edicion(self):
        r=self.enviar({'nombre':'ÓSDE'},'/api/obras-sociales/')
        self.assertEqual(r.status_code,201,r.content)
        for nombre in ('ÓSDE','osde',' OSDE '):
            antes=self.f.snapshot()
            r=self.enviar({'nombre':nombre},'/api/obras-sociales/')
            self.assertEqual(r.status_code,400,r.content)
            self.assertEqual(self.f.snapshot(),antes)
        obra=self.f.pacientes['A'].obra_social
        antes=self.f.snapshot()
        r=self.enviar({'nombre':' osdé '},f'/api/obras-sociales/{obra.pk}/','patch')
        self.assertEqual(r.status_code,400,r.content)
        self.assertEqual(self.f.snapshot(),antes)


if __name__ == '__main__':
    unittest.main()
