# ChessRival local reader

This folder includes the `cbtool` bridge and its Rust source from
[`asavis/oschess-cb-bridge`](https://github.com/asavis/oschess-cb-bridge),
upstream revision `9ac22a2de68497386e5ca8c351444776729b2b7d`.

The upstream reader expected 192-byte `.2cbh` game headers. The Mega Database
2027 supplied for this integration declares 208-byte headers, with the fields
used by the reader retaining their existing offsets. The ChessRival copy sets
`HEADER_RECORD_SIZE` to 208 and is built for that newer format. The adjacent
`cbtool.exe` was built from the modified source with Rust 1.98.1 for Windows.

To rebuild it from this folder, run:

```powershell
cargo build --release -p cbtool
```

The upstream code is licensed under GNU AGPL version 3 only. Its license is
included as `LICENSE`; the rest of the source is kept here to make the binary
reproducible. This reader is launched as a separate local process and reads
the selected database read-only.
