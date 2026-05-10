/**
 * Mock for react-native to avoid ESM import issues in Jest
 */

const React = require('react');

// Basic View mock
const View = (props) => React.createElement('View', props, props.children);

// Basic Text mock
const Text = (props) => React.createElement('Text', props, props.children);

// Pressable/TouchableOpacity mock
const Pressable = (props) => {
  const handlePress = () => {
    if (props.onPress && !props.disabled) {
      props.onPress();
    }
  };
  return React.createElement('div', { ...props, onClick: handlePress }, props.children);
};
const TouchableOpacity = Pressable;
const TouchableWithoutFeedback = Pressable;

// TextInput mock
const TextInput = (props) => {
  return React.createElement('input', {
    ...props,
    onChange: (e) => props.onChangeText?.(e.target.value),
    value: props.value,
    placeholder: props.placeholder,
  });
};

// ScrollView mock
const ScrollView = (props) => React.createElement('div', { ...props, style: { overflow: 'auto', ...props.style } }, props.children);

// FlatList mock
const FlatList = ({ data = [], renderItem, keyExtractor, ...props }) => {
  return React.createElement(
    'div',
    props,
    data.map((item, index) =>
      React.createElement(
        'div',
        { key: keyExtractor ? keyExtractor(item, index) : index },
        renderItem({ item, index })
      )
    )
  );
};

// Image mock
const Image = (props) => React.createElement('img', props);

// ActivityIndicator mock
const ActivityIndicator = (props) => React.createElement('div', { 'data-testid': 'activity-indicator', ...props });

// Modal mock
const Modal = ({ visible, children, ...props }) => {
  if (!visible) return null;
  return React.createElement('div', { 'data-testid': 'modal', ...props }, children);
};

// StyleSheet mock
const StyleSheet = {
  create: (styles) => styles,
  flatten: (styles) => {
    if (Array.isArray(styles)) {
      return styles.reduce((acc, style) => ({ ...acc, ...style }), {});
    }
    return styles;
  },
  absoluteFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  hairlineWidth: 1,
};

// Dimensions mock
const Dimensions = {
  get: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }),
  addEventListener: () => ({ remove: () => {} }),
};

// Platform mock
const Platform = {
  OS: 'ios',
  select: (options) => options.ios || options.default,
  Version: '15.0',
};

// Appearance mock
const Appearance = {
  getColorScheme: () => 'light',
  addChangeListener: () => ({ remove: () => {} }),
};

// Keyboard mock
const Keyboard = {
  addListener: () => ({ remove: () => {} }),
  dismiss: () => {},
};

// Alert mock
const Alert = {
  alert: jest.fn(),
};

// Linking mock
const Linking = {
  openURL: jest.fn().mockResolvedValue(true),
  canOpenURL: jest.fn().mockResolvedValue(true),
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: () => ({ remove: () => {} }),
};

// Animated mock
const Animated = {
  View,
  Text,
  Image,
  ScrollView,
  Value: class AnimatedValue {
    constructor(value) {
      this._value = value;
    }
    setValue(value) {
      this._value = value;
    }
    interpolate({ inputRange, outputRange }) {
      return this;
    }
  },
  timing: () => ({
    start: (callback) => callback?.({ finished: true }),
  }),
  spring: () => ({
    start: (callback) => callback?.({ finished: true }),
  }),
  parallel: (animations) => ({
    start: (callback) => callback?.({ finished: true }),
  }),
  sequence: (animations) => ({
    start: (callback) => callback?.({ finished: true }),
  }),
  loop: (animation) => ({
    start: (callback) => callback?.({ finished: true }),
  }),
  event: () => () => {},
  createAnimatedComponent: (Component) => Component,
};

// NativeModules mock
const NativeModules = {};

// PixelRatio mock
const PixelRatio = {
  get: () => 2,
  getFontScale: () => 1,
  getPixelSizeForLayoutSize: (size) => size * 2,
  roundToNearestPixel: (size) => Math.round(size),
};

// useColorScheme mock
const useColorScheme = () => 'light';

// useWindowDimensions mock
const useWindowDimensions = () => ({ width: 375, height: 812 });

// SafeAreaView mock
const SafeAreaView = (props) => React.createElement('div', props, props.children);

// StatusBar mock
const StatusBar = (props) => null;
StatusBar.setBarStyle = () => {};
StatusBar.setHidden = () => {};
StatusBar.setBackgroundColor = () => {};

// Switch mock
const Switch = (props) => {
  return React.createElement('input', {
    type: 'checkbox',
    checked: props.value,
    onChange: (e) => props.onValueChange?.(e.target.checked),
    disabled: props.disabled,
  });
};

// KeyboardAvoidingView mock
const KeyboardAvoidingView = (props) => React.createElement('div', props, props.children);

// RefreshControl mock
const RefreshControl = (props) => null;

module.exports = {
  View,
  Text,
  Pressable,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  ScrollView,
  FlatList,
  Image,
  ActivityIndicator,
  Modal,
  StyleSheet,
  Dimensions,
  Platform,
  Appearance,
  Keyboard,
  Alert,
  Linking,
  Animated,
  NativeModules,
  PixelRatio,
  useColorScheme,
  useWindowDimensions,
  SafeAreaView,
  StatusBar,
  Switch,
  KeyboardAvoidingView,
  RefreshControl,
};
