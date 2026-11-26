const { spawn } = require("child_process");

module.exports = async (
    Joy,
    msg,
    reply
) => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "cmd.exe" : "npm";
    const args = isWindows
        ? ["/c", "start", "", "cmd", "/k", "npm start"]
        : ["start"];

    const child = spawn(
        command,
        args,
        {
            cwd: process.cwd(),
            env: {
                ...process.env,
                JOYBOT_RESTART_WAIT: "60000"
            },
            detached: true,
            stdio: isWindows ? "ignore" : "inherit",
            windowsHide: false
        }
    );

    child.once("error", async (error) => {
        console.error("Bot restart gagal:", error.message);

        try {
            await reply("Bot restart gagal dijalankan.");
        } catch {}
    });

    child.once("spawn", async () => {
        child.unref();

        try {
            await reply("Menghentikan bot dan menjalankan ulang...");
        } catch (error) {
            console.error(
                "Gagal mengirim pesan botrestart:",
                error.message
            );
        }

        try {
            await Joy.stop?.();
        } catch (error) {
            console.error(
                "Gagal menutup socket saat botrestart:",
                error.message
            );
        }

        process.exit(0);
    });
};
