"""API real con SQLite en memoria; no carga configuracion ni bases existentes."""
import unittest
import test_seguridad_csrf as s
from usuarios.models.rol_model import Permiso, RolPermiso


class ValidacionesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        for code in ('profesionales.crear', 'profesionales.edit'):
            p = Permiso.objects.create(permiso=code, descripcion='Prueba')
            RolPermiso.objects.create(rol=self.f.roles['Administrador'], permiso=p)

    def enviar(self, method, url, data, actor='B'):
        c = self.f.login(actor)
        return getattr(c, method)(url, data, content_type='application/json', HTTP_X_CSRFTOKEN=self.f.token(c))

    def rechazo(self, method, url, data, actor='B'):
        antes = self.f.snapshot()
        r = self.enviar(method, url, data, actor)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.f.snapshot(), antes)

    def paciente(self):
        return dict(nombre='Nuevo', apellido='Paciente', dni='40123456', fecha_nacimiento='2010-01-01',
            direccion='Prueba', consentimiento=True, obra_social=self.f.pacientes['B'].obra_social_id,
            numero_afiliado='A1', tutor=dict(nombre='Tutor', apellido='Prueba', dni='30123456',
                telefono='123', mail='tutor@example.com', domicilio='Prueba', parentesco_id=self.f.parentesco.pk))

    def profesional(self):
        return dict(nombre='Nuevo', apellido='Profesional', dni='50123456', matricula='M99',
            especialidad=self.f.profesionales['A'].especialidad_id, rol=self.f.roles['Profesional'].pk,
            usuario='prueba_nueva', password='Ficticia-1234', mail='pro@example.com')

    def test_domicilios_altas_ediciones_e_historicos(self):
        urls = [(f'/api/pacientes/{self.f.pacientes["B"].pk}/', 'direccion', self.f.pacientes['B']),
                (f'/api/tutores/{self.f.tutor.pk}/', 'domicilio', self.f.tutor)]
        for correo in ['persona@example.com', ' nombre.apellido+tag@example.org ']:
            for url, campo, obj in urls:
                self.rechazo('patch', url, {campo: correo})
            data = self.paciente(); data['direccion'] = correo
            self.rechazo('post', '/api/pacientes/', data)
            data = self.paciente(); data['tutor']['domicilio'] = correo
            self.rechazo('post', '/api/pacientes/', data)
            data = dict(self.paciente()['tutor'], paciente_id=self.f.pacientes['B'].pk, domicilio=correo)
            self.rechazo('post', '/api/tutores/', data)
        for url, campo, obj in urls:
            for domicilio in ['Av. San Martin 123 / 2-B', 'Ruta 8 km 40 s/n', 'Barrio Norte', 'Casa @ esquina']:
                self.assertEqual(self.enviar('patch', url, {campo: domicilio}).status_code, 200)
            type(obj).objects.filter(pk=obj.pk).update(**{campo: 'historico@example.com'})
            for cambios in [{'nombre': 'Otro'}, {campo: 'historico@example.com', 'nombre': 'Otra'}]:
                self.assertEqual(self.enviar('patch', url, cambios).status_code, 200)
            obj.refresh_from_db()
            self.assertEqual(getattr(obj, campo), 'historico@example.com')
        self.assertEqual(self.enviar('post', '/api/pacientes/', self.paciente()).status_code, 201)

    def test_dni_edicion_tres_entidades_y_historicos(self):
        for url, actor in [(f'/api/pacientes/{self.f.pacientes["B"].pk}/','B'),
                           (f'/api/tutores/{self.f.tutor.pk}/','B'),
                           (f'/api/profesionales/{self.f.profesionales["B"].pk}/','admin')]:
            for dni in ['ABC', '123456', '123456789', '12 34567', '1234-567', '１２３４５６７', '']:
                self.rechazo('patch', url, {'dni':dni}, actor)
            for dni in ['1234567', '12345678']:
                self.assertEqual(self.enviar('patch', url, {'dni':dni}, actor).status_code,200)
        for model, obj, url, actor in [(s.Paciente,self.f.pacientes['B'],f'/api/pacientes/{self.f.pacientes["B"].pk}/','B'),
            (s.Tutor,self.f.tutor,f'/api/tutores/{self.f.tutor.pk}/','B'),
            (s.Profesional,self.f.profesionales['B'],f'/api/profesionales/{self.f.profesionales["B"].pk}/','admin')]:
            model.objects.filter(pk=obj.pk).update(dni='HISTORICO',mail='correo-antiguo')
            self.assertEqual(self.enviar('patch',url,{'nombre':'Otro'},actor).status_code,200)
            obj.refresh_from_db();self.assertEqual(obj.dni,'HISTORICO');self.assertEqual(obj.mail,'correo-antiguo')

    def test_alta_paciente_y_tutor_validaciones_rollback(self):
        for cambios in [{'dni':'ABC'},{'mail':'mal'},{'fecha_nacimiento':'2099-01-01'},
                        {'fecha_nacimiento':'2026-02-30'},{'consentimiento':False}]:
            self.rechazo('post','/api/pacientes/',{**self.paciente(),**cambios})
        for cambios in [{'dni':'ABC'},{'mail':'mal'},{'telefono':''}]:
            data=self.paciente();data['tutor'].update(cambios);self.rechazo('post','/api/pacientes/',data)
        for i, dni in enumerate(['1234567','12345678']):
            data=self.paciente();data.update(dni=dni, mail=None if i else '')
            self.assertEqual(self.enviar('post','/api/pacientes/',data).status_code,201)

    def test_tutor_reutilizado_y_correo(self):
        data=dict(nombre='No cambiar',apellido='Prueba',dni=self.f.tutor.dni,mail='otro@example.com',
            domicilio='Prueba',paciente_id=self.f.pacientes['A'].pk,parentesco_id=self.f.parentesco.pk)
        self.rechazo('post','/api/tutores/',{**data,'dni':'ABC'},'admin')
        original=self.f.tutor.nombre
        self.assertEqual(self.enviar('post','/api/tutores/',data,'admin').status_code,201)
        self.f.tutor.refresh_from_db();self.assertEqual(self.f.tutor.nombre,original)
        for mail in ['mal','',None]:self.rechazo('patch',f'/api/tutores/{self.f.tutor.pk}/',{'mail':mail})

    def test_profesional_alta_y_duplicados(self):
        for cambios in [{'dni':'ABC'},{'mail':'mal'},{'mail':'a'*42+'@example.com'},
                        {'usuario':'a b'},{'usuario':'x'*101}]:
            self.rechazo('post','/api/profesionales/',{**self.profesional(),**cambios},'admin')
        self.assertEqual(self.enviar('post','/api/profesionales/',self.profesional(),'admin').status_code,201)
        self.rechazo('post','/api/profesionales/',self.profesional(),'admin')
        self.rechazo('post','/api/profesionales/',{**self.profesional(),'dni':'60123456','matricula':'M100'},'admin')
        url=f'/api/profesionales/{self.f.profesionales["B"].pk}/'
        for mail in ['',None,'valido@example.com']:
            self.assertEqual(self.enviar('patch',url,{'mail':mail},'admin').status_code,200)

    def test_sesion_tipos_vacios_y_parcial(self):
        url=f'/api/sesiones/{self.f.turno_registrado.pk}/'
        for field in ['trabajo_sesion','diagnostico']:
            for value in ['', '   ',None,12,False,[],{}]:
                self.rechazo('patch',url,{field:value,'nota_sesion':'No debe guardarse'})
        for value in [12,False,[],{}]:self.rechazo('patch',url,{'nota_sesion':value})
        self.rechazo('patch',url,{'turno_id':self.f.turno.pk})
        self.rechazo('patch',url,{})
        original=self.f.registro.diagnostico
        for value in ['',None,'Nota nueva']:
            self.assertEqual(self.enviar('patch',url,{'nota_sesion':value}).status_code,200)
            self.f.registro.refresh_from_db();self.assertEqual(self.f.registro.diagnostico,original)
        self.assertEqual(self.enviar('patch',url,{'trabajo_sesion':' Trabajo nuevo '}).status_code,200)
        self.f.registro.refresh_from_db();self.assertEqual(self.f.registro.trabajo_sesion,'Trabajo nuevo')
        for field in ['trabajo_sesion','diagnostico','nota_sesion']:
            data=dict(turno_id=self.f.turno.pk,trabajo_sesion='Trabajo',diagnostico='Diagnostico',nota_sesion='Nota')
            data[field]=42;self.rechazo('post','/api/sesiones/',data)

    def test_nombres_altas_y_ediciones(self):
        tutor = dict(nombre='Tutor',apellido='Prueba',dni='70888999',mail='tutor@example.com',
                     domicilio='Prueba',paciente_id=self.f.pacientes['B'].pk,parentesco_id=self.f.parentesco.pk)
        altas = [('/api/pacientes/',self.paciente(),'B'),('/api/tutores/',tutor,'B'),
                 ('/api/profesionales/',self.profesional(),'admin')]
        ediciones = [(f'/api/pacientes/{self.f.pacientes["B"].pk}/','B'),
                     (f'/api/tutores/{self.f.tutor.pk}/','B'),
                     (f'/api/profesionales/{self.f.profesionales["B"].pk}/','admin')]
        for campo in ('nombre','apellido'):
            for valor in ('', '   ', '535345345', '123 456', '---', '!!!', '123-45'):
                for url,datos,actor in altas:
                    self.rechazo('post',url,{**datos,campo:valor},actor)
                for url,actor in ediciones:
                    self.rechazo('patch',url,{campo:valor},actor)
                datos=self.paciente();datos['tutor'][campo]=valor
                self.rechazo('post','/api/pacientes/',datos)
            for valor in ('María José', 'Muñoz', "O'Connor", 'Anne-Marie', 'D’Arcy', '李'):
                for url,actor in ediciones:
                    self.assertEqual(self.enviar('patch',url,{campo:valor},actor).status_code,200)

    def test_nombres_historicos_no_bloquean_otros_campos(self):
        for modelo,obj,url,actor in [
            (s.Paciente,self.f.pacientes['B'],f'/api/pacientes/{self.f.pacientes["B"].pk}/','B'),
            (s.Tutor,self.f.tutor,f'/api/tutores/{self.f.tutor.pk}/','B'),
            (s.Profesional,self.f.profesionales['B'],f'/api/profesionales/{self.f.profesionales["B"].pk}/','admin')]:
            modelo.objects.filter(pk=obj.pk).update(nombre='123',apellido='!!!')
            self.assertEqual(self.enviar('patch',url,{'mail':'nuevo@example.com'},actor).status_code,200)
            obj.refresh_from_db();self.assertEqual(obj.nombre,'123');self.assertEqual(obj.apellido,'!!!')
            self.rechazo('patch',url,{'apellido':'456'},actor)


if __name__ == '__main__':
    unittest.main()
