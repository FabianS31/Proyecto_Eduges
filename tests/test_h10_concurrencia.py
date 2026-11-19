"""H10 en PostgreSQL 17 descartable. No usa .env ni configuración operativa.

Reutiliza únicamente el lanzador de aislamiento de H05, sin ejecutar su suite
ni modificar su archivo. Cada ejecución crea y elimina un clúster nuevo.
"""
from datetime import date
from pathlib import Path
import sys
import threading
import time
import unittest
import uuid
import test_h05_concurrencia as cluster


def probar(puerto, directorio, password):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'SistemaEduGes/Backend'))
    from django.conf import settings
    settings.configure(SECRET_KEY='h10-ficticio',
        INSTALLED_APPS=['usuarios','profesionales','pacientes','turnos'],
        DATABASES={'default': {'ENGINE':'django.db.backends.postgresql', 'HOST':'127.0.0.1',
            'PORT':puerto, 'NAME':'postgres', 'USER':'eduges_h05_ficticio', 'PASSWORD':password,
            'OPTIONS':{'options':'-c statement_timeout=15000 -c lock_timeout=12000'}}},
        REST_FRAMEWORK={'UNAUTHENTICATED_USER':None}, USE_TZ=True)
    import django
    django.setup()
    from django.apps import apps
    from django.db import connection, connections, transaction
    from rest_framework.test import APIRequestFactory, force_authenticate
    from rest_framework.response import Response
    from APIs.tutores.views import TutorDetailView, TutorListCreateView, ReemplazarPrincipalView, RelacionTutorDetailView
    from pacientes.models import Paciente, Tutor, PacienteTutor, Parentesco
    from pacientes.models.paciente_model import EstadoPaciente
    from pacientes.models.obra_social_model import ObraSocial, EstadoObraSocial, TipoObraSocial
    from profesionales.models.profesional_model import Profesional, Especialidad
    from profesionales.models.estados_profesionales_model import EstadoProfesional
    from profesionales.models.asignacion_model import AsignacionProfesional
    from usuarios.models.usuario_model import Usuario
    from usuarios.models.rol_model import Rol

    with connection.cursor() as c:
        c.execute('SHOW data_directory')
        assert Path(c.fetchone()[0]).resolve() == directorio.resolve()
        c.execute('SHOW listen_addresses')
        assert c.fetchone()[0] == '127.0.0.1'
        c.execute('SHOW transaction_isolation')
        assert c.fetchone()[0] == 'read committed'
    print('H10: identidad, loopback y READ COMMITTED verificados antes de crear tablas ficticias.', flush=True)
    with connection.schema_editor() as schema:
        for modelo in apps.get_models():
            schema.create_model(modelo)

    class ConcurrenciaTests(unittest.TestCase):
        def setUp(self):
            marca=uuid.uuid4().hex[:12]
            self.admin=Usuario.objects.create(usuario=marca+'admin',password='!',activo=True,
                rol=Rol.objects.get_or_create(rol='Administrador')[0])
            self.pro=Usuario.objects.create(usuario=marca+'pro',password='!',activo=True,
                rol=Rol.objects.get_or_create(rol='Profesional')[0])
            profesional=Profesional.objects.create(nombre='Ficticio',apellido='Prueba',dni=marca,matricula=marca,
                usuario=self.pro,rol=self.pro.rol,especialidad=Especialidad.objects.create(especialidad=marca),
                estado_profesional=EstadoProfesional.objects.get_or_create(estado='Activo')[0])
            obra=ObraSocial.objects.create(nombre=marca,tipo=TipoObraSocial.objects.create(tipo=marca),
                estado=EstadoObraSocial.objects.get_or_create(descripcion='Activa')[0])
            self.pacientes=[Paciente.objects.create(nombre='Ficticio',apellido=str(i),dni=marca+str(i),
                fecha_nacimiento=date(2010,1,1),direccion='Ficticia',consentimiento=True,obra_social=obra,
                numero_afiliado=marca,estado=EstadoPaciente.objects.get_or_create(estado='Activo')[0]) for i in range(3)]
            self.asignacion=AsignacionProfesional.objects.create(paciente=self.pacientes[0],
                profesional=profesional,fecha_inicio=date(2020,1,1))
            self.parentesco=Parentesco.objects.create(descripcion=marca)
            self.tutor=Tutor.objects.create(nombre='Candidato',apellido='Ficticio',
                dni=str(10000000+int(marca,16)%89999999),telefono='123',mail='',domicilio='Ficticio')
            self.principales=[]
            self.relaciones=[]
            for paciente in self.pacientes[:2]:
                anterior=Tutor.objects.create(nombre='Anterior',apellido='Ficticio',dni=uuid.uuid4().hex[:20],telefono='456')
                self.principales.append(PacienteTutor.objects.create(paciente=paciente,tutor=anterior,
                    parentesco=self.parentesco,activo=True,responsable_principal=True))
                self.relaciones.append(PacienteTutor.objects.create(paciente=paciente,tutor=self.tutor,
                    parentesco=self.parentesco,activo=True,responsable_principal=False))

        def request(self, view, metodo, datos, actor=None, **kwargs):
            request=getattr(APIRequestFactory(),metodo)('/',datos,format='json')
            force_authenticate(request,user=actor or self.admin)
            return view.as_view()(request,**kwargs)

        def reemplazar(self, indice=0, actor=None):
            return self.request(ReemplazarPrincipalView,'post',
                {'nueva_relacion_id':self.relaciones[indice].pk},actor,pk=self.principales[indice].pk)

        def telefono(self, valor, actor=None):
            return self.request(TutorDetailView,'patch',{'telefono':valor},actor,pk=self.tutor.pk)

        def reactivar(self):
            return self.request(RelacionTutorDetailView,'patch',
                {'activo':True,'responsable_principal':True},pk=self.relaciones[0].pk)

        def reutilizar(self, principal):
            return self.request(TutorListCreateView,'post',{'dni':self.tutor.dni,
                'paciente_id':self.pacientes[2].pk,'parentesco_id':self.parentesco.pk,
                'responsable_principal':principal,'nombre':'No sobrescribir','telefono':'No copiar'})

        def paralelo(self, primera, segunda, espera=True, rollback=False):
            listo,liberar,cerrar=threading.Event(),threading.Event(),threading.Event()
            fin={k:threading.Event() for k in ('a','b')}
            resultados,errores,pids={},{},{}
            def worker(nombre,operacion):
                try:
                    with connection.cursor() as c:
                        c.execute('SELECT pg_backend_pid()')
                        pids[nombre]=c.fetchone()[0]
                    try:
                        with transaction.atomic():
                            resultados[nombre]=operacion()
                            if nombre=='a':
                                listo.set()
                                if not liberar.wait(10): raise TimeoutError('No se liberó A')
                                if rollback: raise RuntimeError('rollback ficticio H10')
                    except RuntimeError as error:
                        if nombre!='a' or not rollback or str(error)!='rollback ficticio H10': raise
                        resultados[nombre]=Response({'rollback':True},status=409)
                except Exception as error:
                    errores[nombre]=repr(error)
                    listo.set()
                finally:
                    fin[nombre].set()
                    cerrar.wait(15)
                    connections.close_all()
            a=threading.Thread(target=worker,args=('a',primera))
            b=threading.Thread(target=worker,args=('b',segunda))
            a.start()
            try:
                self.assertTrue(listo.wait(8),errores)
                self.assertFalse(errores,errores)
                b.start()
                if espera:
                    bloqueada=False
                    limite=time.monotonic()+7
                    while time.monotonic()<limite:
                        if 'b' in pids:
                            with connection.cursor() as c:
                                c.execute('SELECT pg_blocking_pids(%s)',[pids['b']])
                                bloqueada=pids['a'] in c.fetchone()[0]
                            if bloqueada: break
                        if fin['b'].is_set(): break
                        time.sleep(.02)
                    self.assertTrue(bloqueada, (resultados,errores))
                else:
                    self.assertTrue(fin['b'].wait(7),errores)
            finally:
                liberar.set()
                completa=fin['a'].wait(12)
                if b.ident is not None: completa=fin['b'].wait(12) and completa
                cerrar.set()
                a.join(15)
                if b.ident is not None: b.join(15)
            self.assertTrue(completa)
            self.assertFalse(a.is_alive() or b.is_alive())
            self.assertFalse(errores,errores)
            self.assertEqual(len(set(pids.values())),2)
            codigos=[resultados[k].status_code for k in ('a','b')]
            print(f'  PIDs={pids}; espera real={espera}; respuestas={codigos}; sesiones abiertas hasta finalizar ambas operaciones',flush=True)
            return resultados,codigos

        def verificar(self):
            self.tutor.refresh_from_db()
            principales=PacienteTutor.objects.filter(tutor=self.tutor,activo=True,responsable_principal=True)
            if principales.exists(): self.assertTrue((self.tutor.telefono or '').strip())
            for p in self.pacientes:
                self.assertLessEqual(PacienteTutor.objects.filter(paciente=p,activo=True,responsable_principal=True).count(),1)
            for p in self.pacientes:
                self.assertLessEqual(PacienteTutor.objects.filter(paciente=p,tutor=self.tutor).count(),1)

        def test_promover_antes_de_vaciar(self):
            _,codigos=self.paralelo(self.reemplazar,lambda:self.telefono(None,self.pro))
            self.assertEqual(codigos,[200,400]);self.verificar()

        def test_vaciar_antes_de_promover_conserva_anterior(self):
            _,codigos=self.paralelo(lambda:self.telefono(None),self.reemplazar)
            self.assertEqual(codigos,[200,400]);self.verificar()
            self.principales[0].refresh_from_db()
            self.assertTrue(self.principales[0].responsable_principal)

        def test_completar_antes_de_promover(self):
            Tutor.objects.filter(pk=self.tutor.pk).update(telefono=None)
            _,codigos=self.paralelo(lambda:self.telefono('789'),self.reemplazar)
            self.assertEqual(codigos,[200,200]);self.verificar()

        def test_promocion_fallida_libera_para_completar(self):
            Tutor.objects.filter(pk=self.tutor.pk).update(telefono=None)
            _,codigos=self.paralelo(self.reemplazar,lambda:self.telefono('789'),espera=False)
            self.assertEqual(codigos,[400,200]);self.verificar()
            self.principales[0].refresh_from_db()
            self.assertTrue(self.principales[0].responsable_principal)

        def test_dos_reemplazos_mismo_paciente(self):
            _,codigos=self.paralelo(self.reemplazar,self.reemplazar)
            self.assertEqual(codigos,[200,400]);self.verificar()

        def test_compartido_vaciado_desde_otra_relacion(self):
            self.assertEqual(self.reemplazar(1).status_code,200)
            _,codigos=self.paralelo(lambda:self.reemplazar(0),lambda:self.telefono(None,self.pro))
            self.assertEqual(codigos,[200,400]);self.verificar()

        def preparar_reactivacion(self):
            PacienteTutor.objects.filter(pk=self.principales[0].pk).update(responsable_principal=False)
            PacienteTutor.objects.filter(pk=self.relaciones[0].pk).update(activo=False,responsable_principal=True)

        def test_reactivar_antes_de_vaciar(self):
            self.preparar_reactivacion()
            _,codigos=self.paralelo(self.reactivar,lambda:self.telefono(None))
            self.assertEqual(codigos,[200,400]);self.verificar()

        def test_vaciar_antes_de_reactivar(self):
            self.preparar_reactivacion()
            _,codigos=self.paralelo(lambda:self.telefono(None),self.reactivar)
            self.assertEqual(codigos,[200,400]);self.verificar()
            self.relaciones[0].refresh_from_db()
            self.assertFalse(self.relaciones[0].activo)

        def test_rollback_reemplazo_y_liberacion(self):
            _,codigos=self.paralelo(self.reemplazar,lambda:self.telefono(None),rollback=True)
            self.assertEqual(codigos,[409,200]);self.verificar()
            self.principales[0].refresh_from_db();self.relaciones[0].refresh_from_db()
            self.assertTrue(self.principales[0].responsable_principal)
            self.assertFalse(self.relaciones[0].responsable_principal)

        def test_reutilizar_principal_mientras_vacian_contacto(self):
            antes=list(Tutor.objects.filter(pk=self.tutor.pk).values())
            _,codigos=self.paralelo(lambda:self.telefono(None),lambda:self.reutilizar(True))
            self.assertEqual(codigos,[200,400]);self.verificar()
            self.assertFalse(PacienteTutor.objects.filter(paciente=self.pacientes[2]).exists())
            despues=list(Tutor.objects.filter(pk=self.tutor.pk).values())
            antes[0]['telefono']=None
            self.assertEqual(antes,despues)

        def test_reutilizar_adicional_no_sobrescribe(self):
            antes=list(Tutor.objects.filter(pk=self.tutor.pk).values())
            _,codigos=self.paralelo(lambda:self.telefono(None),lambda:self.reutilizar(False))
            self.assertEqual(codigos,[200,201]);self.verificar()
            antes[0]['telefono']=None
            self.assertEqual(antes,list(Tutor.objects.filter(pk=self.tutor.pk).values()))

        def test_permiso_revocado_durante_espera(self):
            def revocar():
                Paciente.objects.select_for_update().get(pk=self.pacientes[0].pk)
                AsignacionProfesional.objects.filter(pk=self.asignacion.pk).update(fecha_fin=date.today())
                return Response(status=200)
            _,codigos=self.paralelo(revocar,lambda:self.reemplazar(actor=self.pro))
            self.assertEqual(codigos,[200,403]);self.verificar()
            self.principales[0].refresh_from_db()
            self.assertTrue(self.principales[0].responsable_principal)

    try:
        resultado=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ConcurrenciaTests))
        return resultado.wasSuccessful()
    finally:
        connections.close_all()


if __name__=='__main__':
    cluster.probar=probar
    sys.exit(0 if cluster.ejecutar() else 1)
