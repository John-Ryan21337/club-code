# Bundled ambient assets

This directory intentionally contains no media binaries.

Every future bundled ambient image must have an entry in `manifest.json` with
content identity, bounded media metadata, original-source provenance, explicit
redistribution and modification rights, attribution requirements, license
evidence, and a named product-distribution review. The filesystem validator is
responsible for matching those declarations to regular, contained files before
an asset can ship.

An image found in local user state or Git history is not approved for
redistribution by that fact alone. Assets with missing or unknown provenance or
license evidence remain excluded.
