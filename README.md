# Mars Radiation Tower

A short browser game for NASA Space Apps. You run a control tower on Mars and use a space-weather alert, a local radiation reading, and the crew radar to decide when to bring three astronauts into shelter.

## Play

Open `index.html` in a modern browser, or [play on GitHub Pages](https://zaidansr.github.io/daysinmars/). There is no download, account, or API key required for the published game.

Use the arrow keys or WASD to move, and E to use a station. On a touch screen, use the movement and station controls in the operator console. You can take as long as you need to read the first alert. The training clock starts when you send an order. Replay to compare the two orders at the same point in the storm.

## Science

The scenario is inspired by the solar particle event observed on Mars on May 20, 2024. The warning window, radiation timeline, and crew route are fictional training values. [NASA/JPL event report](https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/)

- [NASA DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI/) catalogs space-weather events.
- [Curiosity’s RAD](https://www.jpl.nasa.gov/images/pia13580-radiation-assessment-detector-for-mars-science-laboratory/) measures the radiation environment on Mars.
- [NASA’s Mars radiation protection overview](https://science.nasa.gov/resource/real-martians-how-to-protect-astronauts-from-space-radiation-on-mars/) discusses shielding and shelters.

## Publish

Copy this folder’s contents into the repository root. Under **Settings → Pages**, choose **Deploy from a branch**, select the branch containing the files, and select **/ (root)**. The game uses static HTML, CSS, JavaScript, and local assets. [GitHub Pages publishing instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
