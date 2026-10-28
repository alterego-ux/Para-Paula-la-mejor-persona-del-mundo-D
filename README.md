# Entre Líneas — edición local-first para GitHub Pages

Una aplicación personal de escritura con identidad editorial vinotinto. Está construida con HTML, CSS y JavaScript moderno en módulos, sin backend ni servicios de base de datos en la nube. Está pensada para una sola persona y para usarse desde el mismo navegador/perfil donde se guardan los textos.

## Funciones incluidas

- Notas y documentos de texto largo con guardado automático después de unos 500 ms sin escribir.
- Guardado en IndexedDB, estado visible de guardado/error y recuperación al volver a abrir el mismo sitio.
- Versiones previas recuperables cuando un texto cambia de forma significativa.
- Bandeja de entrada para capturas rápidas y borradores.
- Diario personal por fecha.
- Carpetas, etiquetas, favoritos, archivados y papelera recuperable.
- Búsqueda local de títulos y contenido, además de tareas, eventos y carpetas.
- Tareas con vencimiento y prioridad.
- Calendario mensual y eventos en zona horaria `America/Bogota`.
- Avisos internos y notificaciones del navegador mientras la aplicación está abierta, si se ha concedido permiso.
- Colecciones con elementos, estado y fecha.
- Exportación de cada nota a Markdown o texto plano.
- Copias completas JSON, importación validada con opción de combinar o reemplazar, y exportación cifrada con Web Crypto.
- Tema claro/oscuro, menú lateral plegable, diseño adaptable y service worker para cargar el shell estático sin conexión tras la primera visita.

## Importante sobre privacidad y almacenamiento

Los datos de la aplicación permanecen en IndexedDB del navegador; no se envían a un backend de Entre Líneas. La única información guardada en `localStorage` son preferencias visuales pequeñas (tema y menú lateral). El sitio puede cargar recursos estáticos del propio origen y no requiere fuentes, bibliotecas ni API externas.

**IndexedDB no está cifrado automáticamente.** Cualquier persona que tenga acceso a tu perfil del navegador o al dispositivo podría acceder a los datos locales. La función “Copia cifrada” cifra el archivo exportado mediante AES-GCM y una clave derivada con PBKDF2. No cifra la base local. La contraseña de cifrado no se almacena. Si se pierde, el archivo cifrado no puede recuperarse por medio de la aplicación.

El navegador puede eliminar datos por falta de espacio, limpieza del sitio o políticas del dispositivo. La API de almacenamiento persistente se solicita cuando existe; el navegador puede rechazarla. **Haz y conserva copias descargadas en un lugar seguro.** La fecha que se muestra en configuración registra cuándo se inició una exportación, no certifica que el archivo siga existiendo en el equipo.

Como la app se publica como página estática, no hay sincronización entre dispositivos, cuentas ni servidor. La base local usa un nombre derivado del primer segmento de ruta del proyecto para evitar colisiones accidentales. El navegador, sin embargo, aplica permisos por origen (protocolo, dominio y puerto), no por ruta; las rutas de proyectos GitHub Pages bajo el mismo dominio no son fronteras de seguridad entre sí. No guardes los textos en el repositorio. Cada origen (localhost, previsualización y URL publicada) puede tener sus propios datos, de modo que tendrás que importar una copia si deseas trasladarlos.

## Recordatorios: límite técnico

Las tareas y eventos quedan en IndexedDB. Los recordatorios se revisan aproximadamente cada 20 segundos mientras Entre Líneas está abierta. Si el navegador permite notificaciones y Paula da permiso, la aplicación puede mostrar una notificación en ese momento. GitHub Pages no ejecuta procesos de servidor que programen avisos; **no se garantiza ningún recordatorio con la página cerrada, sin conexión o con el dispositivo apagado**.

## Ejecutar localmente

No abras `index.html` mediante `file://`: los módulos JavaScript, IndexedDB y el service worker requieren un contexto adecuado. Usa un servidor estático local.

Con Python:

```bash
cd entre-lineas
python -m http.server 8000
```

Después abre `http://localhost:8000`. También puedes usar la extensión Live Server de Visual Studio Code. No hace falta instalar dependencias para la aplicación.

## Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub, por ejemplo `entre-lineas`.
2. Sube el contenido de esta carpeta a la raíz del repositorio: `index.html`, `styles.css`, `js/`, `icon.svg`, `manifest.webmanifest`, `sw.js` y `README.md`.
3. En el repositorio abre **Settings → Pages**.
4. En “Build and deployment”, elige **Deploy from a branch**.
5. Selecciona la rama `main` y la carpeta `/ (root)`, y guarda.
6. Espera a que GitHub Pages publique el sitio. La URL del proyecto normalmente tendrá el formato `https://TU-USUARIO.github.io/entre-lineas/`.
7. Abre esa URL y crea una nota de prueba. Comprueba que guardó y que sigue allí tras recargar.
8. Antes de trasladar tu información a otro navegador o equipo, exporta una copia JSON y guárdala fuera del repositorio.

Los recursos usan rutas relativas (`./js/app.js`, `./styles.css`, etc.), por lo que funcionan en una ruta de proyecto. No se necesita configurar un backend, secretos, variables de entorno o una base de datos externa.

## Copias de seguridad

- **Exportar JSON:** descarga un objeto versionado que contiene todas las tiendas IndexedDB.
- **Copia cifrada:** introduce y confirma una contraseña. Usa Web Crypto con PBKDF2-SHA-256 y AES-GCM-256. La contraseña no se guarda ni se incluye en el archivo.
- **Importar:** valida el formato y estructura antes de escribir. “Combinar” omite identificadores ya existentes; no sobrescribe registros en conflicto. “Reemplazar” descarga antes una copia JSON del estado actual y luego sustituye las tiendas.
- **Markdown / TXT:** desde una nota abierta, usa los controles `MD` o `TXT`.

Guarda la copia fuera del repositorio y no la publiques: puede contener pensamientos y datos personales.

## Prueba de persistencia

Consulta [`tests/manual-test-plan.md`](./tests/manual-test-plan.md) para reproducir la prueba de autoguardado, cierre y reapertura, diario, tareas/eventos y copia de seguridad. También puedes abrir [`tests/persistence-check.html`](./tests/persistence-check.html) en la misma URL para guardar una nota sintética de más de 30.000 caracteres, recargar la página y comprobar que IndexedDB la conserva; elimina el registro de prueba al terminar. En esta versión, el estado “Guardado” solo se muestra después de que IndexedDB confirma la transacción.

## Estructura

```text
entre-lineas/
├── index.html
├── styles.css
├── icon.svg
├── manifest.webmanifest
├── sw.js
├── js/
│   ├── app.js       # UI, navegación, editor, guardado y acciones
│   ├── db.js        # capa IndexedDB independiente
│   └── utils.js     # fechas, escape de HTML, descargas e iconos
├── tests/
│   └── manual-test-plan.md
└── README.md
```

## Limitaciones conocidas

- El editor conserva el contenido como texto/Markdown, no como un editor visual WYSIWYG con tablas o inserción de imágenes embebidas.
- La base IndexedDB reserva un almacén para metadatos de archivos, pero la gestión de adjuntos binarios todavía no está implementada.
- La copia cifrada protege el archivo exportado, no los datos guardados en IndexedDB.
- Los archivos adjuntos binarios y la sincronización entre dispositivos no forman parte de esta versión estática.
- Los recordatorios no tienen un proceso de fondo que garantice el aviso con la página cerrada.
- El guardado automático reduce el riesgo de pérdida, pero ningún navegador local puede prometer una persistencia absoluta ante borrado manual de datos, fallos del dispositivo o políticas de almacenamiento. Conserva respaldos.
