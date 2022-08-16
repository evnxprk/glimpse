/* eslint-disable max-len */

import { get as nodecg } from './nodecg';

/**
 * This is where you can declare all your replicant to import easily into other files,
 * and to make sure they have any correct settings on startup.
 */

export const clockTimeRep = nodecg().Replicant<number>(
	'clockTime',
	'glimpse-graphics_scoreboard_clock',
	{defaultValue: 1200 * 1000}
);
export const isClockRunningRep = nodecg().Replicant<boolean>(
	'isClockRunning',
	'glimpse-graphics_scoreboard_clock',
	{defaultValue: false, persistent: false}
);
