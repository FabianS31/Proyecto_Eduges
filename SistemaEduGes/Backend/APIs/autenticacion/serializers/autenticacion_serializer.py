from rest_framework import serializers


class LoginSerializer(serializers.Serializer):
    usuario = serializers.CharField()
    password = serializers.CharField()
    recordar = serializers.BooleanField(default=False)