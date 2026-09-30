import { useColorScheme } from 'react-native';

const light = { bg: '#F6F7F5', card: '#FFFFFF', text: '#14201D', muted: '#62706B', border: '#E2E6E3', primary: '#0F766E', onPrimary: '#FFFFFF', danger: '#B42318', warn: '#B54708', ok: '#15803D', chip: '#E7F1EF' };
const dark = { bg: '#0D1513', card: '#16211E', text: '#EEF3F1', muted: '#9BAAA5', border: '#26332F', primary: '#2DD4BF', onPrimary: '#06201C', danger: '#F97066', warn: '#FDB022', ok: '#4ADE80', chip: '#1C2C28' };

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);
