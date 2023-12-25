import { get as nodecg } from './nodecg';
import {Announcement} from "./Announcement";

export const replicants = {
	sync: {
		availablePorts: nodecg().Replicant<string[]>("availablePorts", "glimpse-graphics.sync-settings", {defaultValue: [], persistent: false}),
		selectedPort: nodecg().Replicant<string|null>("selectedPort", "glimpse-graphics.sync-settings", {defaultValue: null}),
		selectedSport: nodecg().Replicant<string>("selectedSport", "glimpse-graphics.sync-settings", {defaultValue: 'Hockey/Lacrosse'}),
		status: nodecg().Replicant<{ connected: boolean, bitrate: number, error: boolean, errorMsg: string }>("status", "glimpse-graphics.sync-settings", {
			defaultValue: {
				connected: false,
				bitrate: 0,
				error: false,
				errorMsg: "Error"
			}, persistent: false
		}),
		values: {
			clock: nodecg().Replicant<boolean>("clock", "glimpse-graphics.sync-settings.values", {defaultValue: false}),
			period: nodecg().Replicant<boolean>("period", "glimpse-graphics.sync-settings.values", {defaultValue: false}),
			teams: [
				{
					score: nodecg().Replicant<boolean>("score", "glimpse-graphics.sync-settings.values.team1", {defaultValue: false}),
					name: nodecg().Replicant<boolean>("name", "glimpse-graphics.sync-settings.values.team1", {defaultValue: false}),
					abbreviation: nodecg().Replicant<boolean>("abbreviation", "glimpse-graphics.sync-settings.values.team1", {defaultValue: false}),
					shots: nodecg().Replicant<boolean>("shots", "glimpse-graphics.sync-settings.values.team1", {defaultValue: false})
				},{
					score: nodecg().Replicant<boolean>("score", "glimpse-graphics.sync-settings.values.team2", {defaultValue: false}),
					name: nodecg().Replicant<boolean>("name", "glimpse-graphics.sync-settings.values.team2", {defaultValue: false}),
					abbreviation: nodecg().Replicant<boolean>("abbreviation", "glimpse-graphics.sync-settings.values.team2", {defaultValue: false}),
					shots: nodecg().Replicant<boolean>("shots", "glimpse-graphics.sync-settings.values.team2", {defaultValue: false})
				}
			],
			baseball: {
				bottomTop: nodecg().Replicant<boolean>("bottomTop", "glimpse-graphics.sync-settings.values.baseball", {defaultValue: false}),
				outsStrikesBalls: nodecg().Replicant<boolean>("outsStrikesBall", "glimpse-graphics.sync-settings.values.baseball", {defaultValue: false}),
			},
			football: {
				downs: nodecg().Replicant<boolean>("downs", "glimpse-graphics.sync-settings.values.football", {defaultValue: false}),
				possession: nodecg().Replicant<boolean>("possession", "glimpse-graphics.sync-settings.values.football", {defaultValue: false}),
				yardsToGo: nodecg().Replicant<boolean>("yardsToGo", "glimpse-graphics.sync-settings.values.football", {defaultValue: false}),
				playClock: nodecg().Replicant<boolean>("playClock", "glimpse-graphics.sync-settings.values.football", {defaultValue: false}),
			}
		}
	},
	gameSettings: {
		style: nodecg().Replicant<'espn'|'rpitv-modern'|'rpitv-classic'>('style', "glimpse-graphics.game-settings.style", {defaultValue: 'rpitv-modern'}),
		clock: {
			enabled: nodecg().Replicant<boolean>("enabled", "glimpse-graphics.game-settings.clock", {defaultValue: true}),
		},
		periods: {
			enabled: nodecg().Replicant<boolean>("enabled", "glimpse-graphics.game-settings.periods", {defaultValue: true}),
			count: nodecg().Replicant<number>('count', 'glimpse-graphics.game-settings.periods', {defaultValue: 3}),
			length: nodecg().Replicant<number>('length', 'glimpse-graphics.game-settings.periods', {defaultValue: 1200_000}),
			overtime: {
				enabled: nodecg().Replicant<boolean>('enabled', 'glimpse-graphics.game-settings.periods.overtime', {defaultValue: false}),
				count: nodecg().Replicant<number>('count', 'glimpse-graphics.game-settings.periods.overtime', {defaultValue: 0}),
				length: nodecg().Replicant<number>('length', 'glimpse-graphics.game-settings.periods.overtime', {defaultValue: 300_000}),
			}
		},
		baseball: {
			bases: nodecg().Replicant<boolean>("bases", "glimpse-graphics.game-settings.baseball", {defaultValue: false}),
			bottomTop: nodecg().Replicant<boolean>("bottomTop", "glimpse-graphics.game-settings.baseball", {defaultValue: false}),
			outsStrikesBalls: nodecg().Replicant<boolean>("outsStrikesBalls", "glimpse-graphics.game-settings.baseball", {defaultValue: false}),
		},
		football: {
			downs: nodecg().Replicant<boolean>("downs", "glimpse-graphics.game-settings.football", {defaultValue: false}),
			possession: nodecg().Replicant<boolean>("possession", "glimpse-graphics.game-settings.football", {defaultValue: false}),
			yardsToGo: nodecg().Replicant<boolean>("yardsToGo", "glimpse-graphics.game-settings.football", {defaultValue: false}),
			playClock: nodecg().Replicant<boolean>("playClock", "glimpse-graphics.game-settings.football", {defaultValue: false}),
		}
	},
	scoreboard: {
		visible: nodecg().Replicant<boolean>('visible', 'glimpse-graphics.scoreboard', {defaultValue: true}),
		clock: {
			time: nodecg().Replicant<number>('time', 'glimpse-graphics.scoreboard.clock', {defaultValue: 1200_000}),
			isRunning: nodecg().Replicant<boolean>('isRunning', 'glimpse-graphics.scoreboard.clock', {defaultValue: false, persistent: false}),
		},
		period: nodecg().Replicant<number>('period', 'glimpse-graphics.scoreboard', {defaultValue: 1})
	},
	teams: [
		{
			enabled: nodecg().Replicant<boolean>("enabled", `glimpse-graphics.game-settings.team0`, {defaultValue: true}),
			score: nodecg().Replicant<number>("score", `glimpse-graphics.scoreboard.team0`, {defaultValue: 0}),
			name: nodecg().Replicant<string>("name", `glimpse-graphics.game-settings.team0`, {defaultValue: "Team 1"}),
			abbreviation: nodecg().Replicant<string>("abbreviation", `glimpse-graphics.game-settings.team0`, {defaultValue: "ONE"}),
			primaryColor: nodecg().Replicant<string>("primaryColor", `glimpse-graphics.game-settings.team0`, {defaultValue: '#ffffff'}),
			secondaryColor: nodecg().Replicant<string>("secondaryColor", `glimpse-graphics.game-settings.team0`, {defaultValue: '#aaaaaa'}),
			logo: nodecg().Replicant<string>("logo", `glimpse-graphics.game-settings.team0`, {defaultValue: ''}),
			schoolName: nodecg().Replicant<string>("schoolName", `glimpse-graphics.game-settings.team0`, {defaultValue: 'School One'}),
			shots: nodecg().Replicant<number>("shots", `glimpse-graphics.game-settings.team0`, {defaultValue: 0})
		},
		{
			enabled: nodecg().Replicant<boolean>("enabled", `glimpse-graphics.game-settings.team1`, {defaultValue: true}),
			score: nodecg().Replicant<number>("score", `glimpse-graphics.scoreboard.team1`, {defaultValue: 0}),
			name: nodecg().Replicant<string>("name", `glimpse-graphics.game-settings.team1`, {defaultValue: "Team 2"}),
			abbreviation: nodecg().Replicant<string>("abbreviation", `glimpse-graphics.game-settings.team1`, {defaultValue: "TWO"}),
			primaryColor: nodecg().Replicant<string>("primaryColor", `glimpse-graphics.game-settings.team1`, {defaultValue: '#ffffff'}),
			secondaryColor: nodecg().Replicant<string>("secondaryColor", `glimpse-graphics.game-settings.team1`, {defaultValue: '#aaaaaa'}),
			logo: nodecg().Replicant<string>("logo", `glimpse-graphics.game-settings.team1`, {defaultValue: ''}),
			schoolName: nodecg().Replicant<string>("schoolName", `glimpse-graphics.game-settings.team1`, {defaultValue: 'School Two'}),
			shots: nodecg().Replicant<number>("shots", `glimpse-graphics.game-settings.team1`, {defaultValue: 0})
		}
	],
	announcements: {
		global: nodecg().Replicant<Announcement[]>("global", `glimpse-graphics.game-settings.announcements`, {defaultValue: []}),
		team1: nodecg().Replicant<Announcement[]>("team1", `glimpse-graphics.game-settings.announcements`, {defaultValue: []}),
		team2: nodecg().Replicant<Announcement[]>("team2", `glimpse-graphics.game-settings.announcements`, {defaultValue: []}),
	},
	lowerThird: {
		school1Logo: nodecg().Replicant<string>("school1Logo", `glimpse-graphics.images.lowerThird`, {defaultValue: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/RPI_Engineers.svg/1200px-RPI_Engineers.svg.png"}),
		school2Logo: nodecg().Replicant<string>("school2Logo", `glimpse-graphics.images.lowerThird`, {defaultValue: ""}),
		scoreboard: nodecg().Replicant<boolean>("scoreboard", `glimpse-graphics.images.lowerThird`, {defaultValue: false}),
		locator: nodecg().Replicant<boolean>("locator", `glimpse-graphics.images.lowerThird`, {defaultValue: false}),
		commentators: {
			show: nodecg().Replicant<boolean>("show", `glimpse-graphics.images.lowerThird`, {defaultValue: false}),
			leftPerson: nodecg().Replicant<string>("leftPerson", `glimpse-graphics.images.lowerThird`, {defaultValue: "Dan Bahl"}),
			rightPerson: nodecg().Replicant<string>("rightPerson", `glimpse-graphics.images.lowerThird`, {defaultValue: "Dan Fridgen"}),
			offset: {
				enabled: nodecg().Replicant<boolean>("enabled", `glimpse-graphics.images.lowerThird`, {defaultValue: false}),
				number: nodecg().Replicant<number>("number", `glimpse-graphics.images.lowerThird`, {defaultValue: 0})
			}
		},
		endGraphics: {
			disabled: nodecg().Replicant<boolean>("disabled", `glimpse-graphics.images.endGraphics`, {defaultValue: false}),
			show: nodecg().Replicant<boolean>("endGraphics", `glimpse-graphics.images.endGraphics`, {defaultValue: false}),
			title: nodecg().Replicant<string>("title", `glimpse-graphics.images.endGraphics`, {defaultValue: "RPI TV Crew"}),
			message: nodecg().Replicant<string>("message", `glimpse-graphics.images.endGraphics`, {defaultValue: "Director\nProducer\nReplay Operator\nCamera Operator"}),
			length: nodecg().Replicant<number>('length', 'glimpse-graphics.endGraphics', {defaultValue: 30})
		},
		bug: nodecg().Replicant<boolean>("bug", `glimpse-graphics.images.lowerThird`, {defaultValue: true}),
	}
}