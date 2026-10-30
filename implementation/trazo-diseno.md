[← Volver al README](../README.md)

# Diseño de Trazo

Cada sección es una decisión y el fallo que evita.

## Una ventana de dibujo por monitor

Cada pantalla tiene su propio lienzo transparente (`canvas_<x>_<y>_<ancho>_<alto>`), creado o cerrado cuando se conectan o desconectan monitores.

**Evita:** en macOS, con "Las pantallas tienen Spaces separados" (la opción por defecto), una ventana no puede cruzar de un monitor a otro; un único lienzo gigante solo se vería en una pantalla. Al conectar un proyector, el lienzo nuevo aparece la siguiente vez que entras a dibujar.

## La barra es otra ventana, no parte del lienzo

La barra vive en su propia ventana diminuta, ajustada al tamaño exacto de su contenido.

**Evita:** en modo puntero el lienzo ignora el ratón para que puedas usar las apps de abajo. Si la barra estuviera dentro del lienzo, también dejaría de recibir clics. Además, en macOS las zonas transparentes de una ventana web siguen atrapando clics: una ventana más grande que la barra bloquearía lo que hay detrás.

## Niveles de ventana propios en macOS

Los lienzos usan el nivel 25 (encima de la barra de menús y el Dock) y la barra el 26. Ambos se unen a todos los Spaces como "auxiliares de pantalla completa".

**Evita:** el "siempre encima" estándar (nivel flotante, 3) queda por debajo del menú y del Dock, y no aparece sobre una presentación de Keynote o PowerPoint en pantalla completa. Con el mismo nivel, el lienzo que recibe el foco taparía la barra.

## Coordenadas nativas: puntos en macOS, píxeles físicos en Windows

Rust convierte monitores y ventanas a "unidades nativas" antes de hablar con la barra (`Rect` en `overlay.rs`).

**Evita:** con monitores de distinta escala (Retina + monitor externo), los píxeles físicos de macOS no forman un espacio continuo: el monitor externo "empieza" dentro del principal. En Windows pasa lo contrario: el espacio continuo es el físico.

## El foco se presta y se devuelve

Al entrar a dibujar, el lienzo bajo el cursor toma el foco (Esc, ⌘Z, teclas de herramienta y el cursor del pincel funcionan). Al volver a puntero, el foco regresa a la app anterior: en macOS se recuerda con un observador de `NSWorkspace`; en Windows con la ventana en primer plano justo antes de dibujar. La barra no puede tomar el foco.

**Evita:** terminar de anotar y que las flechas ya no avancen las diapositivas porque el teclado quedó en Trazo.

## Esc global solo mientras dibujas

Mientras hay una herramienta de dibujo activa, Esc se registra como atajo global; al soltar, se libera.

**Evita:** quedar atrapado con un lienzo que cubre toda la pantalla si por algún motivo perdió el foco. Registrarlo siempre robaría Esc a todas las apps.

## La barra coordina el historial de todos los monitores

Cada lienzo guarda su propio deshacer/rehacer, pero avisa a la barra cada vez que registra un cambio. La barra apila etiquetas de lienzo y envía "deshacer" al que hizo el último cambio.

**Evita:** que ⌘Z deshaga en la pantalla equivocada, o que cada monitor tenga un historial independiente que el usuario no puede ver.

## El borrador quita trazos completos

Tocar un trazo con el borrador lo elimina entero; un gesto de borrado es un solo paso de deshacer.

**Evita:** trazos partidos en pedazos al presentar. Borrar trazos enteros es predecible y la detección usa la propia geometría del canvas (`isPointInPath` / `isPointInStroke`).

## Dos capas por lienzo

La capa de tinta solo se repinta cuando cambian los trazos; la capa "viva" (el trazo en curso y el láser) se limpia en cada fotograma.

**Evita:** repintar cientos de trazos en una pantalla 5K por cada movimiento del ratón.

## La barra se dimensiona sola

Orientación, contraer y expandir son solo CSS. Un `ResizeObserver` mide la barra y mueve la ventana en una sola llamada (`set_frame`), pegada a su borde.

**Evita:** calcular a mano el tamaño de cada variante y los parpadeos de mover y redimensionar en dos pasos.

## Opciones en un menú nativo

"Más opciones" abre un menú del sistema, no un panel HTML.

**Evita:** un panel HTML no puede salir de la ventana diminuta de la barra; agrandar la ventana para mostrarlo volvería a bloquear clics detrás.

## El panel de color es una tercera ventana

El selector de color (editar una muestra o elegir "otro color") vive en su propia ventana, creada oculta al arrancar junto a la barra, con el mismo nivel, el mismo desenfoque y sin foco. Se coloca sola del lado de la barra que mira al centro de la pantalla, centrada en el botón que la abrió. La barra sigue siendo la dueña del estado: el panel solo recibe un color y devuelve el que eliges.

**Evita:** agrandar la ventana de la barra para mostrar el panel, que en macOS extendería el desenfoque a todo el rectángulo y bloquearía clics en el hueco. Como no toma el foco, el selector es solo de puntero (cuadro de saturación y brillo, tono y sugerencias): un campo de texto no recibiría teclas.

## Se cierra como un menú

El panel se cierra al tocar el lienzo, cambiar de herramienta, elegir otro color de la paleta, mover o contraer la barra, con su botón × o con Esc (el primer Esc cierra el panel; el segundo sale del modo dibujo).

**Evita:** un panel olvidado junto a la barra mientras presentas. La barra no ve los clics fuera de sus ventanas, así que el lienzo avisa cuando empieza un gesto.

## El texto se escribe en un cuadro de texto real

Un clic con Texto abre un `<textarea>` transparente con la misma letra, color y halo con que se pintará; al guardarlo, el texto pasa al lienzo como un trazo más.

**Evita:** reimplementar el cursor, la selección, los acentos y los métodos de entrada (japonés, chino) dibujando letra por letra en el canvas.

## Esc y Deshacer cancelan el texto a medio escribir

Cada lienzo avisa a la barra si tiene un cuadro de texto abierto. Mientras lo hay, Esc y Deshacer le piden que lo descarte, y Rehacer queda desactivado: lo que escribes todavía no es un paso del historial.

**Evita:** que Esc guarde el texto y te saque del modo dibujo de golpe (mientras dibujas, Esc es un atajo global y el cuadro nunca lo recibe), y que deshacer o rehacer con el cuadro abierto desordene el historial entre la barra y el lienzo.

## Recolorear cambia solo lo de encima

En cada punto que toca el pincel de recolorear, cambia el trazo más alto bajo ese punto; un gesto entero es un solo paso de deshacer.

**Evita:** que tocar una palabra escrita sobre un resaltado pinte también el resaltado. El borrador sí quita todo lo que toca: borrar es más fácil de predecir que repintar.

## Las formas se despliegan en la barra

Al elegir Formas, su botón se reemplaza por los cuatro botones de forma; al cambiar de herramienta se pliegan otra vez.

**Evita:** buscar la forma a fuerza de clics repetidos, y un menú flotante que necesitaría otra ventana. La barra solo crece mientras usas formas.
