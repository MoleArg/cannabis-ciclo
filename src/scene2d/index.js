import { makeScene2D } from './renderer.js';

// La escena 2D nueva se registra acá; el simulador (script en línea) la usa
// si el navegador tiene WebGL2 y si no, sigue con el dibujo anterior.
window.CicloScene2D = {
  supported() {
    try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
  },
  create(canvas, Base, deps) {
    const Scene2D = makeScene2D(Base, deps);
    return new Scene2D(canvas);
  },
};
