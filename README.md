# AnimeSoul repository

The repository contains two independent implementations:

| Folder | Purpose | Stack |
| --- | --- | --- |
| [`production/`](production/) | Main stable AnimeSoul application and desktop build | React, TypeScript, Vinext, Electron |
| [`python-react/`](python-react/) | Isolated experimental rewrite | React, TypeScript, Vite, Python, FastAPI |

Each folder has its own launcher, dependencies, configuration and detailed
documentation. Run commands from inside the selected version so dependencies
and local saves do not get mixed.

## Main production version

Open [`production/README.md`](production/README.md) or run:

`production/Start AnimeSoul.bat`

## Python + React experiment

Open [`python-react/README.md`](python-react/README.md) or run:

`python-react/Start AnimeSoul Python React.bat`

The Git repository metadata stays at this root, while application code is kept
inside the two version folders.
