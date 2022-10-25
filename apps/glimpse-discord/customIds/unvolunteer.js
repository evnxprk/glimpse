const { db } = require('../firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { EmbedBuilder } = require('discord.js')

module.exports = {
    name: 'unvolunteer',
    async execute(interaction) {
        const setupRef = await db.collection('rpi-tv').doc('setup').get();
        const { proChannel } = setupRef.data();
        const productionsRef = db.collection('rpi-tv').doc('productions');
        await productionsRef.get().then(async (production) => {
            let currentProduction = production.data().productions.find(prod => prod.unVolunteerMsgId === interaction.message.id);
            if (!currentProduction.volunteers.find(volunteer => volunteer === interaction.user.id)) {
                interaction.reply({
                    content: 'FUCK OFF OFFICERS',
                    ephemeral: true
                })
                return;
            }
            await productionsRef.update({
                productions: FieldValue.arrayRemove(currentProduction)
            }).catch(() => interaction.reply({ content: 'Could not update user', ephemeral: true}));
            const index = currentProduction.volunteers.indexOf(interaction.user.id);
            currentProduction.volunteers.splice(index, 1);
            await productionsRef.update({
                productions: FieldValue.arrayUnion(currentProduction)
            }).catch(() => interaction.reply({ content: 'Could not update user', ephemeral: true}));
            let volunteerMsg = await interaction.guild.channels.cache.find(ch => ch.id === proChannel)
                .messages.fetch(currentProduction.volunteerMsgId);
            let volunteers = ``;
            for (let i = 0; i < currentProduction.volunteers.length; i++)
                volunteers += `<@${currentProduction.volunteers[i]}> `;
            let field = volunteerMsg.embeds[0].data.fields
            if (currentProduction.volunteers.length === 0)
                volunteers = '🦗';
            field[3] = {
                name: 'Volunteers',
                value: volunteers
            }
            let unVolunteerMsg = await interaction.guild.channels.cache.find(ch => ch.id === currentProduction.channelId)
                .messages.fetch(currentProduction.unVolunteerMsgId);
            let updatedProduction = EmbedBuilder.from(volunteerMsg.embeds[0]).setFields(field);
            volunteerMsg.edit({embeds: [updatedProduction]});
            unVolunteerMsg.edit({embeds: [updatedProduction]});
            let currProChannel = await interaction.guild.channels.cache.find(ch => ch.id === currentProduction.channelId)
            await currProChannel.permissionOverwrites.delete(interaction.user.id);
        })
    }
}