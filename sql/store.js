import { isJidGroup } from 'baileys';
import { DataTypes } from 'sequelize';
import DATABASE from '../lib/database.js';

const messageDb = DATABASE.define(
	'message',
	{
		jid: {
			type: DataTypes.STRING,
			allowNull: false,
		},
		message: {
			type: DataTypes.JSON,
			allowNull: false,
		},
		id: {
			type: DataTypes.STRING,
			allowNull: false,
			primaryKey: true,
		},
	},
	{
		tableName: 'messages',
		timestamps: true,
	},
);

const contactDb = DATABASE.define(
	'contact',
	{
		jid: {
			type: DataTypes.STRING,
			allowNull: false,
		},
		name: {
			type: DataTypes.STRING,
			allowNull: false,
		},
	},
	{
		tableName: 'contact',
		timestamps: false,
	},
);

const groupMetadataDb = DATABASE.define(
	'groupMetadata',
	{
		jid: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
		subject: { type: DataTypes.STRING, allowNull: true },
		subjectOwner: { type: DataTypes.STRING, allowNull: true },
		subjectTime: { type: DataTypes.DATE, allowNull: true },
		size: { type: DataTypes.INTEGER, allowNull: true },
		creation: { type: DataTypes.DATE, allowNull: true },
		owner: { type: DataTypes.STRING, allowNull: true },
		desc: { type: DataTypes.TEXT, allowNull: true },
		descId: { type: DataTypes.STRING, allowNull: true },
		linkedParent: { type: DataTypes.STRING, allowNull: true },
		restrict: { type: DataTypes.BOOLEAN, allowNull: true },
		announce: { type: DataTypes.BOOLEAN, allowNull: true },
		isCommunity: { type: DataTypes.BOOLEAN, allowNull: true },
		isCommunityAnnounce: { type: DataTypes.BOOLEAN, allowNull: true },
		joinApprovalMode: { type: DataTypes.BOOLEAN, allowNull: true },
		memberAddMode: { type: DataTypes.BOOLEAN, allowNull: true },
		ephemeralDuration: { type: DataTypes.INTEGER, allowNull: true },
	},
	{ tableName: 'metadata', timestamps: true },
);

const groupParticipantsDb = DATABASE.define(
	'groupParticipants',
	{
		jid: { type: DataTypes.STRING, allowNull: false },
		participantId: { type: DataTypes.STRING, allowNull: false },
		admin: { type: DataTypes.STRING, allowNull: true },
	},
	{ tableName: 'participants', timestamps: false },
);

const handleError = error => {
	console.error('Database operation failed:', error);
};

const saveContact = async (jid, name) => {
	if (!jid || !name || isJidGroup(jid)) return;
	const contact = await contactDb.findOne({ where: { jid } });
	if (contact) {
		if (contact.name !== name) {
			await contactDb.update({ name }, { where: { jid } }).catch(handleError);
		}
	} else {
		await contactDb.create({ jid, name }).catch(handleError);
	}
};

const saveMessage = async message => {
	const jid = message.key.remoteJid;
	const id = message.key.id;
	const msg = message;
	if (!id || !jid || !msg) return;
	await saveContact(message.sender, message.pushName);
	let exists = await messageDb.findOne({ where: { id, jid } });
	if (exists) {
		await messageDb.update({ message: msg }, { where: { id, jid } }).catch(handleError);
	} else {
		await messageDb.create({ id, jid, message: msg }).catch(handleError);
	}
};

const loadMessage = async id => {
	if (!id) return;
	const message = await messageDb.findOne({ where: { id } });
	return message ? message.dataValues : null;
};

const getName = async jid => {
	const contact = await contactDb.findOne({ where: { jid } });
	return contact ? contact.name : jid.split('@')[0].replace(/_/g, ' ');
};

const getChatSummary = async () => {
	try {
		const distinctChats = await messageDb.findAll({
			attributes: ['jid'],
			group: ['jid'],
		});

		const chatSummaries = await Promise.all(
			distinctChats.map(async chat => {
				const jid = chat.jid;
				const messageCount = await messageDb.count({
					where: { jid },
				});

				const lastMessage = await messageDb.findOne({
					where: { jid },
					order: [['createdAt', 'DESC']],
				});

				const chatName = isJidGroup(jid) ? jid : await getName(jid);

				return {
					jid,
					name: chatName,
					messageCount,
					lastMessageTimestamp: lastMessage ? lastMessage.createdAt : null,
				};
			}),
		);

		return chatSummaries.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
	} catch (error) {
		console.error('Error retrieving chat summaries:', error);
		return [];
	}
};

const saveGroupMetadata = async (jid, client) => {
	if (!isJidGroup(jid)) return;
	const groupMetadata = await client.groupMetadata(jid);
	const { id, subject, subjectOwner, subjectTime, size, creation, owner, desc, descId, linkedParent, restrict, announce, isCommunity, isCommunityAnnounce, joinApprovalMode, memberAddMode, participants, ephemeralDuration } = groupMetadata;
	const metadata = {
		jid: id,
		subject,
		subjectOwner,
		subjectTime: subjectTime ? new Date(subjectTime * 1000) : null,
		size,
		creation: creation ? new Date(creation * 1000) : null,
		owner,
		desc,
		descId,
		linkedParent,
		restrict,
		announce,
		isCommunity,
		isCommunityAnnounce,
		joinApprovalMode,
		memberAddMode,
		ephemeralDuration,
	};
	const existingGroup = await groupMetadataDb.findOne({ where: { jid } });
	if (existingGroup) {
		await groupMetadataDb.update(metadata, { where: { jid } });
	} else {
		await groupMetadataDb.create(metadata);
	}
	await Promise.all(
		participants.map(async participant => {
			const { id: participantId, admin } = participant;
			const existingParticipant = await groupParticipantsDb.findOne({
				where: { jid, participantId },
			});
			if (existingParticipant) {
				if (existingParticipant.admin !== admin) {
					await groupParticipantsDb.update({ admin }, { where: { jid, participantId } });
				}
			} else {
				await groupParticipantsDb.create({ jid, participantId, admin });
			}
		}),
	);
};

const getGroupMetadata = async jid => {
	if (!isJidGroup(jid)) return null;
	const groupMetadata = await groupMetadataDb.findOne({ where: { jid } });
	if (!groupMetadata) return null;
	const participants = await groupParticipantsDb.findAll({
		where: { jid },
		attributes: ['participantId', 'admin'],
	});
	return {
		...groupMetadata.dataValues,
		participants: participants.map(p => ({
			id: p.participantId,
			admin: p.admin,
		})),
	};
};

export { saveContact, saveMessage, loadMessage, getName, getChatSummary, saveGroupMetadata, getGroupMetadata };
