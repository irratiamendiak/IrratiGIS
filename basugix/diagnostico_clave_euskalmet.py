"""Diagnóstico local seguro para la clave JWT de Euskalmet.

Ejecutar desde basugix con el mismo entorno que usa la aplicación:
    python diagnostico_clave_euskalmet.py

No imprime la clave privada, el token ni valores de variables secretas.
"""
import base64
import hashlib
import json
import os
from pathlib import Path

import jwt
from cryptography.hazmat.primitives import serialization

BASE_DIR = Path(__file__).resolve().parent


def main():
    configured = os.getenv("EUSKALMET_PRIVATE_KEY_PATH", "").strip()
    print("EUSKALMET_PRIVATE_KEY_PATH configurada:", bool(configured))
    if not configured:
        print("RESULTADO: falta la ruta de la clave.")
        return 2

    path = Path(configured)
    if not path.is_absolute():
        path = BASE_DIR / path
    print("Archivo de clave accesible:", path.is_file())
    if not path.is_file():
        print("RESULTADO: el archivo no existe o no es un archivo regular.")
        return 2

    try:
        key_bytes = path.read_bytes()
        private_key = serialization.load_pem_private_key(key_bytes, password=None)
        public_der = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    except Exception as exc:
        # Solo mostramos el tipo de error, nunca datos del archivo.
        print("Clave PEM interpretable: no; tipo de error:", type(exc).__name__)
        return 2

    print("Clave PEM interpretable: sí")
    print("Tipo de clave:", type(private_key).__name__)
    if hasattr(private_key, "key_size"):
        print("Tamaño de clave (bits):", private_key.key_size)
    print("Huella SHA-256 de clave pública (DER):", hashlib.sha256(public_der).hexdigest())

    try:
        # Replica la configuración de claims de la aplicación sin imprimir el JWT.
        owner_claim = os.getenv("EUSKALMET_OWNER_CLAIM", "")
        owner_value = os.getenv("EUSKALMET_OWNER_VALUE", "")
        payload = {
            "aud": "met01.apikey",
            "iss": os.getenv("EUSKALMET_ISSUER", "fire-risk-euskadi"),
            "iat": 1,
            "exp": 3601,
            "version": "1.0.0",
        }
        if owner_claim and owner_value:
            payload[owner_claim] = owner_value
        token = jwt.encode(payload, key_bytes, algorithm="RS256")
        header = jwt.get_unverified_header(token)
        claims = jwt.decode(token, options={"verify_signature": False, "verify_exp": False})
        print("JWT generado localmente: sí")
        print("Algoritmo JWT:", header.get("alg", "no disponible"))
        print("Claves de claims presentes:", ", ".join(sorted(claims.keys())))
        print("Audiencia esperada configurada: met01.apikey")
        print("Emisor configurado presente:", bool(claims.get("iss")))
        print("RESULTADO: la clave puede firmar un JWT RS256 localmente.")
        print("NOTA: esto no confirma que la clave pública esté registrada en Euskalmet ni que sus claims sean aceptados.")
        return 0
    except Exception as exc:
        print("Firma local JWT: error; tipo:", type(exc).__name__)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
