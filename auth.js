(() => {
  "use strict";

  // Autenticación desactivada: IrratiGIS entra directamente en la aplicación.
  // Se conserva la API pública mínima para que el resto de la web no falle
  // si consulta IrratiGISAuth o IrratiGISAuthReady.
  const API = "https://irratigis-erreketak.kulixka-mendiak.workers.dev";

  window.IrratiGISAuth = {
    API,
    TOKEN_KEY: null,
    getToken: () => null,
    logout: () => location.reload()
  };

  // Mantener una promesa resuelta por compatibilidad con index.html.
  window.IrratiGISAuthReady = Promise.resolve(true);
})();
