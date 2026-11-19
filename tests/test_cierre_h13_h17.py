"""Cierre H13/H17: SQLite en memoria, mocks y catálogos ficticios."""
import unittest
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import test_seguridad_csrf as s
from APIs.obras_sociales.serializers.obra_social_serializer import ObraSocialSerializer
from APIs.obras_sociales.services.obra_social_service import ObraSocialService
from APIs.pacientes.serializers.paciente_serializer import PacienteSerializer
from APIs.profesionales.permisos import validar_edicion_cuenta
from APIs.autenticacion.permisos import TienePermiso
from APIs.servicios.errores_catalogo import CatalogoNoDisponible
from rest_framework.exceptions import PermissionDenied


class CierreCatalogosTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert s.connection.settings_dict['NAME']==':memory:'
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f=s.SeguridadCSRFTests();self.addCleanup(self.f.doCleanups);self.f.setUp()
        self.c=self.f.login('super')
        self.obra=self.f.pacientes['A'].obra_social

    def enviar(self,datos,pk=None):
        return getattr(self.c,'post' if pk is None else 'patch')(
            '/api/obras-sociales/'+(f'{pk}/' if pk else ''),datos,
            content_type='application/json',HTTP_X_CSRFTOKEN=self.f.token(self.c))

    def test_activa_otro_id_y_desactivacion_posterior(self):
        s.EstadoObraSocial.objects.filter(pk=self.obra.estado_id).update(descripcion='Inactiva')
        activa=s.EstadoObraSocial.objects.create(descripcion='Activa')
        self.assertNotEqual(activa.pk,1)
        historicas=list(s.ObraSocial.objects.values())
        r=self.enviar({'nombre':'Cobertura ficticia nueva'})
        self.assertEqual(r.status_code,201,r.content)
        nueva=s.ObraSocial.objects.get(pk=r.json()['id'])
        self.assertEqual(nueva.estado_id,activa.pk)
        self.assertEqual(nueva.tipo_id,self.obra.tipo_id)
        r=self.enviar({'estado_id':self.obra.estado_id},nueva.pk)
        self.assertEqual(r.status_code,200,r.content)
        nueva.refresh_from_db();self.assertEqual(nueva.estado.descripcion,'Inactiva')
        self.assertEqual(list(s.ObraSocial.objects.exclude(pk=nueva.pk).values()),historicas)

    def test_activa_ambigua_incluso_con_id_explicito(self):
        s.EstadoObraSocial.objects.create(descripcion=' ACTIVA ')
        antes=self.f.snapshot()
        for extra in ({},{'estado_id':self.obra.estado_id}):
            r=self.enviar({'nombre':'Ficticia nueva',**extra})
            self.assertEqual(r.status_code,503,r.content)
            self.assertEqual(self.f.snapshot(),antes)

    def test_activa_ausente_no_inventa_estado(self):
        s.EstadoObraSocial.objects.filter(pk=self.obra.estado_id).update(descripcion='Inactiva')
        antes=self.f.snapshot();r=self.enviar({'nombre':'Ficticia nueva'})
        self.assertEqual(r.status_code,503,r.content);self.assertEqual(self.f.snapshot(),antes)

    def test_varios_tipos_requieren_decision_no_impiden_edicion(self):
        s.TipoObraSocial.objects.create(tipo='Otro tipo ficticio')
        antes=self.f.snapshot();r=self.enviar({'nombre':'Ficticia nueva'})
        self.assertEqual(r.status_code,503,r.content);self.assertEqual(self.f.snapshot(),antes)
        r=self.enviar({'contacto':'Contacto ficticio'},self.obra.pk)
        self.assertEqual(r.status_code,200,r.content)
        # Se conserva la API explícita existente: no es un default arbitrario.
        r=self.enviar({'nombre':'Explícita ficticia','tipo_id':self.obra.tipo_id})
        self.assertEqual(r.status_code,201,r.content)

    def test_tipo_unico_valido_y_catalogos_incompletos_no_relacionados(self):
        s.TipoObraSocial.objects.create(tipo='   ')
        s.EstadoObraSocial.objects.create(descripcion='   ')
        original=s.EstadoObraSocial.from_db
        def cargar(cls,*args,**kwargs):
            obj=original(*args,**kwargs)
            if obj.descripcion=='   ':obj.descripcion=None
            return obj
        with patch.object(s.EstadoObraSocial,'from_db',classmethod(cargar)):
            r=self.enviar({'nombre':'Ficticia nueva'})
        self.assertEqual(r.status_code,201,r.content)
        self.assertEqual(r.json()['tipo']['id'],self.obra.tipo_id)
        self.assertIs(PacienteSerializer().validate_obra_social(self.obra),self.obra)

    def test_tipo_vacio_o_null_sin_escrituras(self):
        for catalogo in ([],[SimpleNamespace(tipo=None)],[SimpleNamespace(tipo='  ')]):
            antes=self.f.snapshot()
            with patch.object(s.TipoObraSocial.objects,'all',return_value=catalogo):
                r=self.enviar({'nombre':'Ficticia nueva'})
            self.assertEqual(r.status_code,503,r.content);self.assertEqual(self.f.snapshot(),antes)
        for valor in (None,'  '):
            self.obra.tipo.tipo=valor
            with self.assertRaises(CatalogoNoDisponible):
                ObraSocialSerializer(self.obra).validate({'contacto':'Ficticio'})

    def test_estado_explicito_distinto_de_activa_es_400(self):
        for descripcion in ('Inactiva',' INACTIVA ','Otro'):
            estado=s.EstadoObraSocial.objects.create(descripcion=descripcion)
            antes=self.f.snapshot();r=self.enviar({'nombre':'Ficticia nueva','estado_id':estado.pk})
            self.assertEqual(r.status_code,400,r.content);self.assertEqual(self.f.snapshot(),antes)

    def test_estado_incompleto_afecta_solo_la_operacion_dependiente(self):
        for valor in (None,'','   '):
            self.obra.estado.descripcion=valor
            with self.assertRaises(CatalogoNoDisponible):
                PacienteSerializer().validate_obra_social(self.obra)
            with self.assertRaises(CatalogoNoDisponible):
                ObraSocialSerializer(self.obra).validate({})
        self.obra.estado=None
        with self.assertRaises(CatalogoNoDisponible):
            PacienteSerializer().validate_obra_social(self.obra)

    def test_roles_incompletos_no_conceden_acceso(self):
        pro=self.f.profesionales['B']
        for valor in (None,'','  '):
            pro.usuario.rol=None if valor is None else s.Rol(rol=valor)
            with self.assertRaises(CatalogoNoDisponible):validar_edicion_cuenta(self.f.usuarios['A'],pro)
            actor=SimpleNamespace(rol=None if valor is None else SimpleNamespace(rol=valor))
            with self.assertRaises(PermissionDenied):validar_edicion_cuenta(actor,pro)
            with patch('usuarios.models.rol_model.RolPermiso.objects.filter',side_effect=AssertionError('No consultar permisos sin rol')):
                self.assertFalse(TienePermiso().has_permission(SimpleNamespace(user=actor),SimpleNamespace(permiso_requerido='profesionales.edit')))

    def test_normalizacion_duplicados_sin_escrituras(self):
        self.obra.nombre='Cobertura Ágil';self.obra.save(update_fields=['nombre'])
        antes=self.f.snapshot()
        for nombre in ('Cobertura Ágil',' cobertura agil ','COBERTURA AGIL'):
            r=self.enviar({'nombre':nombre})
            self.assertEqual(r.status_code,400,r.content);self.assertEqual(self.f.snapshot(),antes)

    def test_h05_validar_y_guardar_dentro_del_mismo_bloqueo(self):
        dentro=[]
        original_contexto=ObraSocialService.escritura_serializada
        original_validar=ObraSocialSerializer.validate
        original_guardar=ObraSocialSerializer.save
        @contextmanager
        def contexto():
            with original_contexto():
                dentro.append(True)
                try:yield
                finally:dentro.pop()
        def validar(serializer,attrs):
            self.assertTrue(dentro);self.assertTrue(s.connection.in_atomic_block)
            return original_validar(serializer,attrs)
        def guardar(serializer,**kwargs):
            self.assertTrue(dentro);self.assertTrue(s.connection.in_atomic_block)
            return original_guardar(serializer,**kwargs)
        with patch.object(ObraSocialService,'escritura_serializada',contexto),patch.object(ObraSocialSerializer,'validate',validar),patch.object(ObraSocialSerializer,'save',guardar):
            self.assertEqual(self.enviar({'nombre':'Ficticia nueva'}).status_code,201)
            self.assertEqual(self.enviar({'contacto':'Ficticio'},self.obra.pk).status_code,200)
        self.assertEqual(dentro,[])

    def test_h05_clave_y_bloqueo_transaccional_conservados(self):
        conexion=MagicMock(vendor='postgresql')
        with patch('APIs.obras_sociales.services.obra_social_service.connection',conexion):
            with ObraSocialService.escritura_serializada():
                conexion.cursor.return_value.__enter__.return_value.execute.assert_called_once_with(
                    'SELECT pg_advisory_xact_lock(%s, %s)',[1162106183,5])

    def test_errores_inesperados_no_se_disfrazan_de_catalogo(self):
        antes=self.f.snapshot()
        with patch.object(s.TipoObraSocial.objects,'all',side_effect=RuntimeError('Fallo ficticio inesperado')):
            with self.assertRaisesRegex(RuntimeError,'Fallo ficticio inesperado'):
                self.enviar({'nombre':'Ficticia nueva'})
        self.assertEqual(self.f.snapshot(),antes)


if __name__=='__main__':unittest.main()
