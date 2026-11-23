import { helpView } from '../../../utils/info/views.js';

export default {
  name: 'help',

  async run(client, message, args, context) {
    const { type, text, options } = helpView(context);
    await context.send(type, text, options);
  },
};
