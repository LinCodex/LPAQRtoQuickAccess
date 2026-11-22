try {
  const l = localStorage.getItem('ezrefill-language');
  document.documentElement.lang =
    l === 'en' || l === 'zh-Hans'
      ? l
      : (navigator.languages?.[0] || navigator.language || '').toLowerCase().startsWith('zh')
        ? 'zh-Hans'
        : 'en';
} catch {
  document.documentElement.lang = (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh-Hans' : 'en';
}
