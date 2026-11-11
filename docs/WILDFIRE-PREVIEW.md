# Wildfire terrain preview

The pull request preview is deployed to a separate Cloudflare Pages project,
`irratigis-wildfire-preview`. It does not deploy or modify the production
Cloudflare Worker, D1 database, scheduled triggers, or the production Pages site.

The preview publishes the frontend from `feature/wildfire-mdt-provider`.
The terrain COG is a public, read-only R2 object and is accessed using HTTP
Range requests.

## Backend isolation

The current application authentication module still points at the production
API, and the Pages API bridge currently allows the production GitHub Pages
origin only. Do not broaden that CORS policy or use production write operations
from the preview just to make preview login work.

Until a separate preview API or a deliberately read-only preview mode is
implemented, treat this deployment as a frontend/terrain-provider preview only.
Do not use it to create, edit, or delete operational records.

## Deployment

GitHub Actions workflow: `.github/workflows/deploy-wildfire-preview.yml`.

Required repository secret: `CLOUDFLARE_API_TOKEN` with permission to manage
Cloudflare Pages projects and deployments. The workflow creates/deploys only
the separate `irratigis-wildfire-preview` Pages project.
