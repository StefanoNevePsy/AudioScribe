/* eslint-disable no-undef */
// Mock dei moduli nativi per consentire il rendering dei componenti nei test.

jest.mock('react-native-share-menu', () => ({
  getInitialShare: jest.fn(),
  addNewShareListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('@react-native-community/blur', () => ({
  BlurView: 'BlurView',
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
