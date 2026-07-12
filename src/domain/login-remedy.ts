// The ask-marcel-office-cli library's error remedies prescribe its own binary, which the
// plugin never ships (SPEC §15.1 R1) — point the user at the plugin's login entry instead.
// `loginCommand` is the runnable form of that entry (absolute path — the reader's cwd is the
// user's project, not the plugin root). Pure string mapping shared by the Office adapter and
// the login flow.
export const rewriteBinaryRemedy = (message: string, loginCommand: string): string =>
  message.replaceAll('`ask-marcel-office logout && ask-marcel-office login`', `\`${loginCommand} --fresh\``).replaceAll('`ask-marcel-office login`', `\`${loginCommand}\``);
