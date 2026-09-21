"""Diagnóstico seguro: deriva la pública de la clave privada configurada y compara huella.
No imprime ni devuelve la clave privada, la pública completa ni JWT.
"""
import hashlib
import os
from pathlib import Path

EXPECTED = "d4271159f9bff2daa9515683291a9b1459a1a74068a8c4aaf2577b1b4cdb21a5"


def run():
    configured = os.getenv("EUSKALMET_PRIVATE_KEY_PATH", "").strip()
    if not configured:
        print("EUSKALMET_KEY_DIAG status=ERROR reason=PRIVATE_KEY_PATH_NOT_SET", flush=True)
        return
    path = Path(configured)
    if not path.is_absolute():
        path = Path(__file__).resolve().parent / path
    if not path.is_file():
        print("EUSKALMET_KEY_DIAG status=ERROR reason=PRIVATE_KEY_FILE_NOT_FOUND", flush=True)
        return
    try:
        from cryptography.hazmat.primitives import serialization
        private_key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        public_der = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        fingerprint = hashlib.sha256(public_der).hexdigest()
        print(
            "EUSKALMET_KEY_DIAG "
            f"status=OK fingerprint={fingerprint} matches_registered={fingerprint == EXPECTED}",
            flush=True,
        )
    except Exception as exc:
        # Solo se registra el tipo de error; nunca se vuelca el contenido del secreto.
        print(f"EUSKALMET_KEY_DIAG status=ERROR reason={type(exc).__name__}", flush=True)


if __name__ == "__main__":
    run()
