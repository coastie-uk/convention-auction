# Third-Party Notices

This application includes the following third-party software. The container
image sections apply when ManeBid is distributed as the Docker images supplied
by this project.

## Container images

The container images include operating-system packages and application runtime
dependencies in addition to the browser libraries listed below.

### Caddy 2.11.4

Homepage: <https://caddyserver.com/>

Source: <https://github.com/caddyserver/caddy>

License: Apache License 2.0

Caddy is included in the `manebid-web` image. A copy of the Apache License 2.0
is available at [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt) and at
`/usr/share/licenses/manebid/Apache-2.0.txt` inside the image. The exact Caddy
binary version and compiled Go module list are recorded in
`/usr/share/licenses/manebid/caddy-build-info.txt`.

Caddy is a registered trademark of Stack Holdings GmbH. The trademark is used
only to identify the upstream software.

### Node.js

Homepage: <https://nodejs.org/>

Source: <https://github.com/nodejs/node>

License: MIT and the additional third-party terms reproduced in Node.js's
upstream license file.

Node.js is included in the `manebid-backend` image. Its complete upstream
license file is retained at `/usr/local/LICENSE` inside that image.

### Production npm dependencies

The backend image contains the production dependency tree installed from
`backend/package-lock.json`. Each installed package's upstream license file is
retained within `/app/node_modules` when supplied by that package. The build
also generates an exact name, version, declared-license, and retained-license
inventory at:

`/usr/share/licenses/manebid/npm-production-packages.tsv`

This dependency tree includes software under permissive licenses such as MIT,
ISC, BSD, Apache-2.0, 0BSD, Zlib, and BlueOak-1.0.0. Platform-specific Sharp
and libvips packages may also be present under Apache-2.0 and
LGPL-3.0-or-later terms; consult the generated inventory for the exact image.

### Container operating-system packages

The backend image is based on Debian. Debian package copyright and license
information is retained under `/usr/share/doc/*/copyright`, and the exact
installed package versions are recorded in:

`/usr/share/licenses/manebid/debian-packages.tsv`

The web image is based on Alpine Linux. Its exact installed package versions
and declared SPDX license identifiers are recorded in:

`/usr/share/licenses/manebid/alpine-packages.tsv`

These inventories are generated again whenever the images are rebuilt. Source
code for the corresponding Debian and Alpine packages is available through
their respective distribution source repositories:

- <https://sources.debian.org/>
- <https://gitlab.alpinelinux.org/alpine/aports>

### Tini

Homepage and source: <https://github.com/krallin/tini>

License: MIT

Tini is included in the backend image. Its Debian copyright and license
information is retained at `/usr/share/doc/tini/copyright`.

## DayPilot Modal 3.15.1

Homepage: <https://modal.daypilot.org/>

License: Apache License 2.0

Copyright (c) 2010 - 2019 Annpoint, s.r.o.

Required acknowledgement:

This product includes DayPilot Modal (https://modal.daypilot.org).

The distributed JavaScript file also retains the upstream license block.

## CropperJS 1.5.13


Homepage: <https://fengyuanchen.github.io/cropperjs>

License: MIT

Copyright 2015-present Chen Fengyuan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
