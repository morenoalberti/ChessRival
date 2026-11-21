# Local ChessBase database reader

This folder contains the Windows `cbtool` bridge and the Rust source used to
build it. The reader is based on [`asavis/oschess-cb-bridge`](https://github.com/asavis/oschess-cb-bridge),
revision `9ac22a2de68497386e5ca8c351444776729b2b7d`.

ChessRival uses the bridge locally to read 2CBH databases without uploading
the database. It exposes a loopback-only API to the local Python server. The
reader source is included under the GNU AGPL version 3 only; see `LICENSE`.
ChessRival's 208-byte header adjustment is documented in
`CHESSRIVAL-PATCH.md`.

Rebuild on Windows with Rust 1.98.1:

```powershell
cargo build --release -p cbtool
```
