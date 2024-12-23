import config from '../config.js';
import { isSudo } from '../sql/sudo.js';
import { isBanned } from '../sql/ban.js';

const READ_MORE = '\n'.repeat(4000);
const commands = [];
const prefix = config.PREFIX.split('').join('|') || ',./^!#&$%'.split('').join('|');

const isPrefix = userInput =>
	!prefix ||
	new RegExp(
		`^(${prefix
			.split('')
			.map(char => `\\${char}`)
			.join('|')})$`,
	).test(userInput);

function bot(cmd, excution) {
	cmd.function = excution;
	cmd.pattern = new RegExp(`^(${prefix})\\s*(${cmd.pattern})(?:\\s+(.*))?$`, 'i');
	cmd.isPublic = cmd.isPublic || false;
	cmd.isGroup = cmd.isGroup || false;
	cmd.dontAddCommandList = cmd.dontAddCommandList || false;

	commands.push(cmd);
	return cmd;
}

const Plugins = async (msg, conn, ev) => {
	if (!msg.body) return;

	for (const cmd of commands) {
		const match = msg.body.match(cmd.pattern);

		if (match) {
			const Msg = { ...msg, prefix: match[1], command: `${match[1]}${match[2]}` };
			const sudo = await isSudo(Msg.sender, Msg.user);
			const banned = await isBanned(Msg.sender);
			const mode = config.MODE === 'private';
			const args = match[3] ?? '';

			if (!isPrefix(match[1])) continue;
			if (mode && !sudo) return;
			if (banned) return await msg.send('```You are banned from using commands!```');
			if (cmd.isGroup && !Msg.key.remoteJid.endsWith('@g.us')) return msg.send('```This Command is for Groups```');
			if (!mode && !cmd.isPublic && !sudo) return await msg.send('```For My Owners Only!```');
			if (config.CMD_REACT) await ev.react('⏳');
			if (config.READ_CMD) await conn.readMessages([Msg.key]);

			try {
				await cmd.function(ev, args, { ...ev });
			} catch (err) {
				return msg.error(cmd, err);
			}
		} else if (cmd.on) {
			await cmd.function(ev, msg.body, msg, conn);
		}
	}
};

export { READ_MORE, commands, bot, Plugins };
