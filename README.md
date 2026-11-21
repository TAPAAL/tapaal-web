# TAPAAL Web prototype

**Experimental prototype. This editor is not ready for general use.** It explores how TAPAAL modelling and simulation can work in a browser. Use copies of your nets for testing and keep the originals. Use desktop TAPAAL for verification and for models that rely on unsupported features.

## Try it locally

[Install Nub](https://nubjs.com/docs#install), then run these commands at the repository root. Nub uses Node.js 24 as specified in [`.node-version`](.node-version) and downloads it if needed. Run `nub node` to see which version it selected.

```sh
nub ci
nub run start
```

Open [the workspace](http://localhost:4200/workspace). Choose **File → Example nets…** and open **Intro example** to explore a timed model. Switch to **Simulate** to advance time and fire enabled transitions. Save edits to a file to keep them after refreshing the page.

## What works today

The editor supports uncoloured timed and untimed nets, multiple components, shared places and transitions, constants, and manual exploration of game nets. It can open and save supported TAPAAL files. The gallery bundles 29 desktop examples, of which 19 currently open in the web editor.

Coloured and stochastic models, query verification, and strategy synthesis are outside the current prototype. Saved queries can be preserved. Native TAPAAL 4.0.4 resets nonzero initial token ages when loading files, so use the web JSON format when those ages must survive a round trip. See the [parity inventory](NATIVE-PARITY.md) and [implementation notes](IMPLEMENTATION-NOTES.md) for details.

## Development

Run `nub run test` for the unit and fixture suite, `nub run format:check` for formatting and `nub run build` for a production build. The example files and tests are self-contained. Browser and native comparison harnesses live in `scripts/` and have their own prerequisites. See [AGENTS.md](AGENTS.md) for the contribution workflow.

## Origin and licensing

The prototype was extracted from the `web/` directory of the TAPAAL GUI development checkout at commit `b28c211cdc8a874b6efdc5f03d2940b61860a1a1`. Historical design reports refer to paths in that checkout.

Original contributions to this web prototype are licensed under the [MIT License](LICENSE). Upstream materials retain their existing terms, including the [TAPAAL example nets and distribution notice](public/examples/LICENSE.txt). See [example provenance](public/examples/PROVENANCE.txt). Dependencies retain their respective licenses.
