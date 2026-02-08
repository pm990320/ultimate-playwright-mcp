#!/bin/bash

# Test MCP server by sending list_tools request

echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node dist/cli.js &
PID=$!

sleep 3

# Check if daemon started
node dist/daemon/cli.js status

# Kill the MCP server
kill $PID 2>/dev/null

echo "Test complete"
