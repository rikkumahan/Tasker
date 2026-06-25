@echo off
echo [%date% %time%] Starting MCP server... >> C:\Users\rikku\OneDrive\Desktop\tasker\mcp_wrapper.log
"node" "C:\Users\rikku\OneDrive\Desktop\open-design\apps\daemon\dist\cli.js" "mcp" "--daemon-url" "http://127.0.0.1:56350" 2>> C:\Users\rikku\OneDrive\Desktop\tasker\mcp_wrapper.log
echo [%date% %time%] MCP server exited with code %errorlevel% >> C:\Users\rikku\OneDrive\Desktop\tasker\mcp_wrapper.log
