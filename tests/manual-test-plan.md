# Plan de prueba manual — Entre Líneas

Ejecuta la aplicación desde `http://localhost:8000` o la URL HTTPS de GitHub Pages. Usa contenido sintético; no pongas datos personales reales en archivos del repositorio.

## Persistencia de una nota extensa

1. Crea una nota y escribe un título reconocible como `Prueba local de persistencia`.
2. En el cuerpo, pega varios párrafos y repite texto hasta superar 30.000 caracteres.
3. Espera a que el indicador muestre `Guardado` (no solo `Guardando…`).
4. Recarga la página y abre la nota desde “Todas las notas”.
5. Comprueba que el título, los párrafos, los saltos de línea y el final del texto son idénticos.
6. Abre otra sección y vuelve a la nota; confirma que el contenido permanece.
7. Edita una parte, espera al guardado y consulta “Historial” tras hacer varios cambios con intervalos suficientes para crear una versión recuperable.

## Borradores, diario y organización

1. Abre “Capturar una idea”, pega texto con al menos tres párrafos y guarda en la bandeja.
2. Comprueba que aparece en “Bandeja de entrada”, abre la captura y añade una etiqueta y una carpeta.
3. Crea una entrada del diario, añade texto, espera al estado guardado y recarga.
4. Crea una carpeta, mueve una nota a esa carpeta y búscala desde el filtro de notas.
5. Marca una nota como favorita, archiva otra, y verifica que ambas aparecen en la sección correcta.
6. Mueve una nota a la papelera y recupérala. Comprueba también la opción de eliminación definitiva con datos de prueba.

## Tareas, calendario y notificaciones

1. Crea una tarea con fecha límite y prioridad, recarga, márcala completada y vuelve a abrir la sección.
2. Crea un evento con fecha y hora local de Bogotá, además de un aviso previo.
3. Comprueba que aparece en el día correcto del calendario y en “Próximos eventos”.
4. Si necesitas probar una notificación, crea un evento cercano, deja la app abierta y concede el permiso al navegador.
5. Cierra la pestaña para comprobar que no debe prometerse una notificación de fondo: la app estática no tiene servidor que programe avisos.

## Copia e importación

1. Desde Configuración → Copias de seguridad, exporta JSON.
2. Comprueba que el archivo se descarga y tiene `format: "entre-lineas-backup"`.
3. Exporta también una copia cifrada con una contraseña temporal y prueba descifrarla al importarla.
4. Crea una nota adicional y después importa el JSON con “Combinar”. Debe conservar la nota nueva y omitir IDs que ya existían.
5. Antes de probar “Reemplazar”, usa solamente datos sintéticos. Comprueba que se descarga un respaldo del estado previo y que después se restaura el archivo seleccionado.
6. Exporta una nota abierta como Markdown y como TXT; comprueba que el contenido y saltos de línea son legibles.

## Interfaz y accesibilidad

Prueba anchuras de 320, 360, 390, 430, 768, 1024, 1280 y 1440 píxeles. Revisa tema claro/oscuro, menú lateral en móvil, uso con teclado, foco visible y movimiento reducido. Comprueba que los controles de guardar, búsqueda, editor, tareas, eventos y exportación no quedan ocultos.

## Qué no se debe interpretar como garantía

La persistencia del navegador no equivale a una copia externa. La solicitud de almacenamiento persistente puede no ser concedida. La app no cifra automáticamente IndexedDB y no puede garantizar notificaciones con la página cerrada. Conserva respaldos descargados fuera del dispositivo si necesitas recuperación ante pérdida del navegador o del equipo.
