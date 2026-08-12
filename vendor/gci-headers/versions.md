# GCI header versions

Every GemStone version whose GCI headers have been checked against a local install under `~/Documents/GemStone/`, and which content folder its headers match. Captured 2026-08-12 from installs present on that machine at the time.

| GemStone version | Folder | gci.ht sha256 | gcicmn.ht sha256 | gcits.hf sha256 | gcits.ht sha256 |
|---|---|---|---|---|---|
| 3.6.2 | [3.6.2](3.6.2/) | `aadeb5e4` | `9d402e30` | `7b5825e4` | — (not present before 3.7.2) |
| 3.6.3 | [3.6.2](3.6.2/) | `aadeb5e4` | `9d402e30` | `7b5825e4` | — |
| 3.6.4 | [3.6.4](3.6.4/) | `edbc6171` | `f8fd862b` | `16c0b022` | — |
| 3.6.5 | [3.6.4](3.6.4/) | `edbc6171` | `f8fd862b` | `16c0b022` | — |
| 3.6.6 | [3.6.6](3.6.6/) | `bbf48032` | `bbaae488` | `7c9b3861` | — |
| 3.6.8 | [3.6.8](3.6.8/) | `f60dd662` | `58cf1136` | `44353b0d` | — |
| 3.7.0 | [3.7.0](3.7.0/) | `ec9cdc27` | `239fb201` | `29c62182` | — |
| 3.7.1 | [3.7.1](3.7.1/) | `7e8614c5` | `bff40429` | `537643af` | — |
| 3.7.2 | [3.7.2](3.7.2/) | `41f7c518` | `03d82497` | `6c9ff61e` | `d287f74c` |
| 3.7.2.2 | [3.7.2](3.7.2/) | `41f7c518` | `03d82497` | `6c9ff61e` | `d287f74c` |
| 3.7.4.1 | [3.7.4.1](3.7.4.1/) | `b4883655` | `cb4fdb1d` | `5ca21076` | `7058fb85` |
| 3.7.4.3 | [3.7.4.1](3.7.4.1/) | `b4883655` | `cb4fdb1d` | `5ca21076` | `7058fb85` |
| 3.7.5 | [3.7.5](3.7.5/) | `c3af9c02` | `ec9dd5cb` | `46e936d5` | `98381241` |

Hashes are truncated to the first 8 hex characters for readability; run `shasum -a 256` on a file to verify the full digest.

## Notes

- `gcits.ht` doesn't exist before 3.7.2 — that's a real absence in the vendor distribution, not a gap in this snapshot.
- 3.6.2/3.6.3, 3.6.4/3.6.5, 3.7.2/3.7.2.2, and 3.7.4.1/3.7.4.3 each ship byte-identical headers within the pair, hence the shared folder.
- Source install path pattern: `~/Documents/GemStone/GemStone64Bit<version>-arm64.Darwin/include/`.
