import net from "node:net";

const ports = [5432, 6379];
const deadline = Date.now() + 60_000;
for (const port of ports) {
  while (!(await open(port))) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for port ${port}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log(`ready port ${port}`);
}

function open(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
