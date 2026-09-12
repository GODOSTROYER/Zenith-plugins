# References and provenance

[Home](../README.md) · [Verification](verification.md)

Official documentation inspected on September 12, 2026 informs development contracts, not client certification.

- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins): manifests, direct MCP server maps and marketplace conventions.
- [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference): installed package components, resource roots and validation commands.
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): requirements for the still-unimplemented remote authorization gate.
- [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports): stdio and Streamable HTTP context; this adapter remains limited to stateless JSON responses.
- [Merged Zenith reader baseline](https://github.com/GODOSTROYER/zenith/tree/2d56ecc3abe77f560d9c58bee14370b0789f386a): authoritative source for this increment's application contract.

The user's `Zenith-plugins-build-prompt.md` supplied the implementation target. Its requested [rethinking-skills-and-prompts article](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) could not be retrieved; no contents are invented or attributed to it. Earlier research and protocol version assertions were treated as hypotheses and checked against the current repository.
