import { createConsola } from "consola";

export const logger = createConsola({
  level: 5,
  // formatOptions: {
  //   colors: process.stdout.isTTY === true,
  //   date: false,
  // },
});

export { LogLevels } from "consola";
export type { ConsolaInstance, LogLevel } from "consola";
