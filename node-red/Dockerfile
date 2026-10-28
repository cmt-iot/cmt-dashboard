# Node-RED with the MySQL palette node pre-installed, so the flow's
# "mysql" nodes work out of the box (no manual Palette Manager step).
FROM docker.io/nodered/node-red:latest

# The image's working dir is /usr/src/node-red — extra nodes install there.
RUN npm install --no-audit --no-fund --omit=dev node-red-node-mysql
