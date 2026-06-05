import { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.bhupesh.fittrack',
  appName: 'FitTrack',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: '360000316522-rjhql740rjb5ff38pi2qiujchs31lfdj.apps.googleusercontent.com',
      forceCodeForRefreshToken: true
    }
  }
};
export default config;
