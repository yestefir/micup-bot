import { serverInfoView } from '../../../utils/info/views.js';

export default {
  name: 'serverinfo',
  guildOnly: true,

  async run(client, message, args, context) {
    const { type, text, options } = serverInfoView(context);
    await context.send(type, text, options);
  },
};
