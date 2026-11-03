# manumatthys.com

Source of the website of Manu Matthys: a static site (HTML, CSS, JavaScript), in English and Basque.

The home screen is a background of glitch video processed live with [Hydra](https://github.com/hydra-synth/hydra-synth)
that reacts to the music (levels and kicks) and to the mouse or the tilt of a phone, which in turn plays the music
(filter and echo through Web Audio). See `public/interactive.js`.

## Not in this repository

- `public/assets/fonts/`: Suisse Int'l, a commercial typeface licensed separately. Without it the site falls back to the system font.
- `public/assets/audio/background.mp3`: the background music.

Both are kept out of git on purpose; the live site has them.

## Licence

- **Code**: GNU AGPL v3 or later (see `LICENSE`), because the site embeds hydra-synth (AGPL-3.0, `public/assets/vendor/`).
- **Music, images, videos, record covers and the logo** belong to their authors. All rights reserved: they are not covered by the code licence.
