from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet


runtime = Path(__file__).resolve().parent / "runtime"
runtime.mkdir(mode=0o700, parents=True, exist_ok=True)
(runtime / "data").mkdir(mode=0o700, exist_ok=True)
env_file = runtime / ".env"
if not env_file.exists():
    value = Fernet.generate_key().decode()
    env_file.write_text(
        "\n".join([
            f"CLOUD_HOME_SECRET_KEY={value}",
            "CLOUD_HOME_DATABASE_PATH=/data/cloud-home.db",
            "CLOUD_HOME_COOKIE_SECURE=0",
            "FILEBROWSER_URL=http://127.0.0.1:8080",
            "JELLYFIN_URL=http://127.0.0.1:8096",
            "MEDIA_AUTO_LOGIN_USERNAME=",
            "MEDIA_AUTO_LOGIN_PASSWORD=",
            "PORT=8079",
            "",
        ])
    )
    os.chmod(env_file, 0o600)
else:
    content = env_file.read_text()
    content = content.replace(
        "FILEBROWSER_URL=http://host.docker.internal:8080",
        "FILEBROWSER_URL=http://127.0.0.1:8080",
    ).replace(
        "JELLYFIN_URL=http://host.docker.internal:8096",
        "JELLYFIN_URL=http://127.0.0.1:8096",
    )
    env_file.write_text(content)
    os.chmod(env_file, 0o600)
