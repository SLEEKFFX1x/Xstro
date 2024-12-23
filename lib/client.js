import { makeWASocket, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, DisconnectReason, Browsers } from 'baileys';
import config from '../config.js';
import Message from './Base.js';
import SequelizeAuthState from './Auth.js';
import { commands, Plugins } from './cmds.js';
import { loadMessage, saveMessage, getGroupMetadata } from '../sql/store.js';
import { manageProcess, updateGroupMetadataPeriodically } from './utils.js';
import { schedules } from './schedule.js';
import { smsg } from './message.js';
import { isLatest } from '../utils/updater.js';

const logger = { level: 'silent', log: () => {}, info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, trace: () => {}, child: () => logger };

const connect = async () => {
	const session = await SequelizeAuthState(config.SESSION_ID, logger);
	const { state, saveCreds } = session;
	const { version } = await fetchLatestBaileysVersion();

	const conn = makeWASocket({
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		printQRInTerminal: false,
		logger,
		browser: Browsers.macOS('Desktop'),
		version,
		keepAliveIntervalMs: 2000,
		syncFullHistory: true,
		defaultQueryTimeoutMs: undefined,
		retryRequestDelayMs: undefined,
		markOnlineOnConnect: true,
		fireInitQueries: true,
		emitOwnEvents: true,
		getMessage: async key => {
			const store = await loadMessage(key.id);
			if (store) return store;
			return { conversation: null };
		},
		cachedGroupMetadata: async jid => {
			const store = await getGroupMetadata(jid);
			if (store) return store;
			return null;
		},
	});

	conn.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
		if (connection === 'close') {
			lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut ? connect() : manageProcess();
		} else if (connection === 'open') {
			let status = `XSTRO BOT ${config.VERSION}\nPREFIX: ${config.PREFIX}\nPLUGINS: ${commands.length}\nMODE: ${config.MODE}\n\nCONFIGURATIONS\nREAD_CMDS: ${config.READ_CMD}\nAUTO_READ: ${config.AUTO_READ}\nREAD_STATUS: ${config.AUTO_STATUS_READ}\nTIME_ZONE: ${config.TIME_ZONE}`;

			const updated = await isLatest();
			if (!updated.latest) {
				status += `\n\nBot isn't on Latest Version.\nUse ${config.PREFIX}update now`;
			}

			await conn.sendMessage(conn.user.id, { text: '```' + status + '```' });
			console.log(`Connected\n${status}`);
		} else if (connection === 'connecting') {
			console.log('Connecting...');
		}
	});

	conn.ev.on('creds.update', saveCreds);
	conn.ev.on('messages.upsert', async ({ messages, type }) => {
		if (type === 'notify') {
			const msg = await smsg(JSON.parse(JSON.stringify(messages[0])), conn);
			await Plugins(msg, conn, new Message(conn, msg));
			await saveMessage(msg);
			if (config.AUTO_READ) await conn.readMessages([msg.key]);
			if (config.AUTO_STATUS_READ && msg.from === 'status@broadcast') await conn.readMessages([msg.key]);
		}
	});
	updateGroupMetadataPeriodically(conn);
	schedules(conn);
	return conn;
};

export default connect;
