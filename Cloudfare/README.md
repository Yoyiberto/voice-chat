# Cloudflare D1 lab

Prueba aislada para validar el almacenamiento de Voice Chat antes de sustituir Supabase. El nombre de la carpeta conserva `Cloudfare` como se solicitó; el proveedor es **Cloudflare**.

## Local

```text
npm install
npm run d1:migrate
npm run dev
```

Wrangler servirá el Worker normalmente en `http://localhost:8787`. Para abrir el cliente, visita `http://localhost:8787/test-client.html`.

Los tests unitarios no necesitan cuenta Cloudflare:

```text
npm test
```

## Cuenta Cloudflare (paso mínimo posterior)

1. Ejecutar `npx wrangler login` (recomendado), o definir `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en el entorno.
2. Crear D1: `npx wrangler d1 create voice-chat-d1`.
3. Copiar el `database_id` devuelto en `wrangler.toml`.
4. Aplicar migraciones: `npm run d1:migrate:remote`.

No pongas aquí claves de Groq/OpenRouter. Este Worker solo almacena chats; las credenciales deben seguir siendo secretos independientes. Si se activa `D1_TEST_TOKEN`, el cliente deberá enviar `Authorization: Bearer ...`; para la prueba local puede dejarse vacío.

## Contrato

Las respuestas conservan los nombres compatibles con la aplicación existente: `folder_id`, `system_prompt`, `messages`, `created_at` y `updated_at`. D1 usa SQLite, por lo que `messages` se almacena internamente como `messages_json`.
