import { pingView } from '../../../utils/message/ping.js';

export default {
  name: 'ping',

  async run(client, message, args, context) {
    const { type, text } = pingView(context, message.createdAt);
    await context.send(type, text);
  },
};
