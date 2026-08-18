# GCI header versions

Every GemStone version whose GCI headers have been checked against a local install under `~/Documents/GemStone/`, and which content folder its headers match. Captured 2026-08-12 from installs present on that machine at the time.

| GemStone version | Folder | gci.ht sha256 | gcicmn.ht sha256 | gcits.hf sha256 | gcits.ht sha256 | gcioop.ht sha256 | gcioc.ht sha256 | gcierr.ht sha256 |
|---|---|---|---|---|---|---|---|---|
| 3.6.2 | [3.6.2](3.6.2/) | `aadeb5e4` | `9d402e30` | `7b5825e4` | — (not present before 3.7.2) | `32523764` | `9ee4eb33` | `8be2528b` |
| 3.6.3 | [3.6.3](3.6.3/) | `aadeb5e4` | `9d402e30` | `7b5825e4` | — | `32523764` | `e07f9ab5` | `032adc97` |
| 3.6.4 | [3.6.4](3.6.4/) | `edbc6171` | `f8fd862b` | `16c0b022` | — | `c86e9818` | `897c49b1` | `99fbaa0c` |
| 3.6.5 | [3.6.4](3.6.4/) | `edbc6171` | `f8fd862b` | `16c0b022` | — | `c86e9818` | `897c49b1` | `99fbaa0c` |
| 3.6.6 | [3.6.6](3.6.6/) | `bbf48032` | `bbaae488` | `7c9b3861` | — | `086b1ed4` | `a92106f9` | `42f4cf5c` |
| 3.6.8 | [3.6.8](3.6.8/) | `f60dd662` | `58cf1136` | `44353b0d` | — | `95ea7469` | `d1295fab` | `c56de362` |
| 3.7.0 | [3.7.0](3.7.0/) | `ec9cdc27` | `239fb201` | `29c62182` | — | `9e9c353b` | `bc5d420b` | `103c5367` |
| 3.7.1 | [3.7.1](3.7.1/) | `7e8614c5` | `bff40429` | `537643af` | — | `a71ae4c8` | `6dde75ef` | `9d715bdd` |
| 3.7.2 | [3.7.2](3.7.2/) | `41f7c518` | `03d82497` | `6c9ff61e` | `d287f74c` | `f6d6f4c6` | `d76dbddd` | `d17b6bab` |
| 3.7.2.2 | [3.7.2](3.7.2/) | `41f7c518` | `03d82497` | `6c9ff61e` | `d287f74c` | `f6d6f4c6` | `d76dbddd` | `d17b6bab` |
| 3.7.4.1 | [3.7.4.1](3.7.4.1/) | `b4883655` | `cb4fdb1d` | `5ca21076` | `7058fb85` | `cf362002` | `16e1b5c1` | `80fa97ac` |
| 3.7.4.3 | [3.7.4.1](3.7.4.1/) | `b4883655` | `cb4fdb1d` | `5ca21076` | `7058fb85` | `cf362002` | `16e1b5c1` | `80fa97ac` |
| 3.7.5 | [3.7.5](3.7.5/) | `c3af9c02` | `ec9dd5cb` | `46e936d5` | `98381241` | `09576634` | `20aed16e` | `de9edcbe` |

Hashes are truncated to the first 8 hex characters for readability; run `shasum -a 256` on a file to verify the full digest.

## Notes

- `gcits.ht` doesn't exist before 3.7.2 — that's a real absence in the vendor distribution, not a gap in this snapshot.
- 3.6.4/3.6.5, 3.7.2/3.7.2.2, and 3.7.4.1/3.7.4.3 each ship byte-identical headers within the pair, hence the shared folder.
- 3.6.2 and 3.6.3 are **not** such a pair, despite looking like one: their `gci.ht`, `gcicmn.ht`, `gcits.hf`, and `gcioop.ht` are byte-identical, but `gcioc.ht` and `gcierr.ht` differ. They get one folder each. This is exactly the kind of near-miss the snapshot exists to catch — 3.6.3 constants read off 3.6.2's headers would be wrong.
- Headers reachable from these but deliberately not vendored: `flag.ht` and `l2unix.hf` (from `gci.ht`), `version.ht` (from `gcicmn.ht`), `gcirtl.hf` and `gcistring.hf` (from `gcits.hf`). They carry build-configuration, platform, and version-stamp plumbing rather than the signatures, struct layouts, and constants this project transcribes. The seven vendored files are closed under `#include` for that purpose: `gcioop.ht` and `gcioc.ht` include nothing, and `gcierr.ht` includes only `gcioop.ht`.
- Source install path pattern: `~/Documents/GemStone/GemStone64Bit<version>-<arch>.<platform>/include/` — e.g. `-arm64.Darwin` on Apple silicon, `-x86_64.Linux` on Linux devs and CI.
