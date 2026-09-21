"""Diagnóstico local seguro de la clave privada RSA de Euskalmet.

Ejecutar en basugix con el entorno de Render: python diagnostico_clave_euskalmet.py
No imprime contenido de la clave, tokens ni valores de variables secretas.
"""
import hashlib
import os
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

BASE_DIR = Path(__file__).resolve().parent


def main():
    configured = os.getenv("EUSKALMET_PRIVATE_KEY_PATH", "").strip()
    print("Ruta de clave configurada:", bool(configured))
    if not configured:
        print("RESULTADO: falta EUSKALMET_PRIVATE_KEY_PATH")
        return 2

    path = Path(configured)
    if not path.is_absolute():
        path = BASE_DIR / path
    if not path.is_file():
        print("Archivo accesible: no")
        return 2
    print("Archivo accesible: sí")

    try:
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    except Exception as exc:
        print("Clave PEM válida: no; tipo de error:", type(exc).__name__)
        return 2

    print("Clave PEM válida: sí")
    print("Clave RSA:", isinstance(key, rsa.RSAPrivateKey))
    if not isinstance(key, rsa.RSAPrivateKey):
        print("RESULTADO: la clave no es RSA y no corresponde al flujo RS256")
        return 2

    public_der = key.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    print("Bits RSA:", key.key_size)
    print("Huella SHA-256 pública DER:", hashlib.sha256(public_der).hexdigest())

    try:
        probe = b"BASUGIX Euskalmet RS256 local signing diagnostic"
        signature = key.sign(probe, padding.PKCS1v15(), hashes.SHA256())
        key.public_key().verify(signature, probe, padding.PKCS1v15(), hashes.SHA256())
    except Exception as exc:
        print("Firma/verificación local RS256: error; tipo:", type(exc).__name__)
        return 2

    print("Firma/verificación local RS256: correcta")
    print("NOTA: esto no verifica el registro de la clave pública en Euskalmet ni los claims exigidos por su API.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
