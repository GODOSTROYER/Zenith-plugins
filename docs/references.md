# References and provenance

[Home](../README.md) · [Verification](verification.md)

Official references inspected on September 12, 2026. These inform development manifests and protocol boundaries; reading a reference does not establish client compatibility.

- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins): plugin manifest, direct MCP server map and repository marketplace conventions.
- [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference): package components and `${CLAUDE_PLUGIN_ROOT}` resource resolution.
- [MCP 2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports): stdio and Streamable HTTP behavior. This implementation provides only a limited stateless JSON-response profile.
- [TypeScript 5.8.3 registry metadata](https://registry.npmjs.org/typescript/5.8.3): version, tarball and integrity used in the lockfile.
- [Zenith baseline](https://github.com/GODOSTROYER/zenith/tree/70d9c4a610b96f3d45bed0d85bd4155bbbf295f7): source of application behavior and provider restrictions.

Prior conversation research is not a substitute for current source or tests. No unavailable article's contents are represented here.
