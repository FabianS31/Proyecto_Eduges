"""H14/H19: datos ficticios y SQLite en memoria, sin configuracion operativa."""
import unittest
import test_seguridad_csrf as s
import test_altas_etapa4b as altas

NOMBRES = ['McDonald', "O'Neill", 'María José', 'Ana-María', 'DE LA CRUZ', 'Muñoz', "D'Angelo", 'Ana']
INVALIDOS = ['123456', '123456789', '12.345.678', '12-345-678', '1234567²',
             '１２３４５６７８', '123A4567', ' 1234567', '1234567 ']


class NombresDniTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert s.connection.settings_dict['NAME'] == ':memory:'
        s.SeguridadCSRFTests.setUpClass()

    def setUp(self):
        self.f = s.SeguridadCSRFTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.c = self.f.login('super')

    def enviar(self, url, datos, metodo='patch'):
        cliente = self.f.login('A') if metodo == 'patch' and url.startswith('/api/pacientes/') else self.c
        return getattr(cliente, metodo)(url, datos, content_type='application/json',
                                       HTTP_X_CSRFTOKEN=self.f.token(cliente))

    def destinos(self):
        return [(f'/api/pacientes/{self.f.pacientes["A"].pk}/',self.f.pacientes['A']),
                (f'/api/profesionales/{self.f.profesionales["A"].pk}/',self.f.profesionales['A']),
                (f'/api/tutores/{self.f.tutor.pk}/',self.f.tutor)]

    def alta(self, tipo):
        if tipo == 'paciente':
            datos=altas.AltaTests.datos(self)
            datos['profesional']=self.f.profesionales['A'].pk
            return '/api/pacientes/',datos
        if tipo == 'profesional':
            return '/api/profesionales/',dict(nombre='McDonald',apellido="O'Neill",dni='12345678',
                matricula='FICTICIA',especialidad=self.f.profesionales['A'].especialidad_id,
                rol=self.f.roles['Profesional'].pk,usuario='nuevo_ficticio',password='ClaveFicticia123')
        return '/api/tutores/',dict(nombre='McDonald',apellido="O'Neill",dni='12345678',
            mail='ficticio@example.com',domicilio='Ficticio',paciente_id=self.f.pacientes['A'].pk,
            parentesco_id=self.f.parentesco.pk,responsable_principal=False)

    def test_nombres_edicion_presentacion_y_limites(self):
        for url,obj in self.destinos():
            for nombre in NOMBRES+['A'*99,'A'*100]:
                r=self.enviar(url,{'nombre':f' {nombre} ','apellido':nombre})
                self.assertEqual(r.status_code,200,r.content)
                obj.refresh_from_db()
                self.assertEqual(obj.nombre,nombre)
                self.assertEqual(obj.apellido,nombre)
                self.assertEqual(r.json()['nombre'],nombre)
            for nombre in ['', '1234', 'A'*101]:
                antes=self.f.snapshot()
                self.assertEqual(self.enviar(url,{'nombre':nombre}).status_code,400)
                self.assertEqual(self.f.snapshot(),antes)

    def test_altas_preservan_nombres_y_dni_validos(self):
        for tipo in ['paciente','profesional','tutor']:
            for dni in ['1234567','12345678']:
                with self.subTest(tipo=tipo,dni=dni),s.transaction.atomic():
                    url,datos=self.alta(tipo)
                    datos.update(nombre='McDonald',apellido="O'Neill",dni=dni)
                    if tipo=='paciente':
                        datos['tutor'].update(nombre='DE LA CRUZ',apellido="D'Angelo")
                    r=self.enviar(url,datos,'post')
                    self.assertEqual(r.status_code,201,r.content)
                    self.assertEqual(r.json()['nombre'],'McDonald')
                    self.assertEqual(r.json()['apellido'],"O'Neill")
                    if tipo=='paciente':
                        tutor=s.Tutor.objects.get(dni=datos['tutor']['dni'])
                        self.assertEqual((tutor.nombre,tutor.apellido),('DE LA CRUZ',"D'Angelo"))
                    s.transaction.set_rollback(True)

    def test_dni_invalido_rechazado_en_altas_sin_escrituras(self):
        for tipo in ['paciente','profesional','tutor','tutor_integral']:
            for dni in INVALIDOS:
                url,datos=self.alta('paciente' if tipo=='tutor_integral' else tipo)
                (datos['tutor'] if tipo=='tutor_integral' else datos)['dni']=dni
                antes=self.f.snapshot()
                r=self.enviar(url,datos,'post')
                self.assertEqual(r.status_code,400,(tipo,dni,r.content))
                self.assertEqual(self.f.snapshot(),antes)

    def test_edicion_dni_y_historicos_intactos(self):
        for url,obj in self.destinos():
            type(obj).objects.filter(pk=obj.pk).update(dni='LEGADO-1',nombre='McDonald',apellido="O'Neill")
            r=self.enviar(url,{'mail':'nuevo@example.com'})
            self.assertEqual(r.status_code,200,r.content)
            obj.refresh_from_db()
            self.assertEqual((obj.dni,obj.nombre,obj.apellido),('LEGADO-1','McDonald',"O'Neill"))
            self.assertEqual(self.enviar(url,{'dni':'LEGADO-1'}).status_code,200)
            for dni in INVALIDOS:
                antes=self.f.snapshot()
                self.assertEqual(self.enviar(url,{'dni':dni}).status_code,400)
                self.assertEqual(self.f.snapshot(),antes)
            for dni in ['1234567','12345678']:
                self.assertEqual(self.enviar(url,{'dni':dni}).status_code,200)
                obj.refresh_from_db(); self.assertEqual(obj.dni,dni)


if __name__ == '__main__':
    unittest.main()
