import type { SupportedLanguage } from './types';

export const HEADER_LANGUAGE_OPTIONS: Array<{ value: SupportedLanguage; label: string }> = [
  { value: 'en', label: 'EN' },
  { value: 'kn', label: 'KN (ಕನ್ನಡ)' },
  { value: 'hi', label: 'HI (हिन्दी)' },
];

export interface AppStrings {
  nav: {
    admin: string;
    dashboard: string;
    invoices: string;
    recovery: string;
    forecast: string;
    customers: string;
    expenses: string;
    copilot: string;
    reports: string;
    billing: string;
    settings: string;
  };
  header: {
    createInvoice: string;
    signedInAs: string;
    signOut: string;
    simulatedDemo: string;
    planSuffix: string;
  };
  recovery: {
    title: string;
    subtitle: string;
    stageLabel: string;
    generateAi: string;
    drafting: string;
    loadTemplate: string;
  };
  forecast: {
    title: string;
    subtitle: string;
    explainAi: string;
    analyzing: string;
  };
  copilot: {
    title: string;
    subtitle: string;
    askButton: string;
    analyzing: string;
    readOnly: string;
    suggestedLabel: string;
    placeholder: string;
  };
}

export const STRINGS: Record<SupportedLanguage, AppStrings> = {
  en: {
    nav: {
      admin: 'Platform Admin',
      dashboard: 'Dashboard',
      invoices: 'Smart Invoices',
      recovery: 'Payment Recovery',
      forecast: 'Cash Forecast',
      customers: 'Customers & Risk',
      expenses: 'Expenses',
      copilot: 'AI Copilot',
      reports: 'Reports',
      billing: 'Plans & Billing',
      settings: 'Settings',
    },
    header: {
      createInvoice: 'Create Invoice',
      signedInAs: 'Signed in as',
      signOut: 'Sign Out',
      simulatedDemo: 'Simulated Demo',
      planSuffix: 'Plan',
    },
    recovery: {
      title: 'AI Payment Recovery Assistant',
      subtitle:
        'Review overdue invoices, analyze customer delay patterns, and approve respectful payment follow-ups.',
      stageLabel: 'Reminder Stage',
      generateAi: 'Generate with Gemini AI',
      drafting: 'Drafting...',
      loadTemplate: 'Load Standard Template',
    },
    forecast: {
      title: 'Cash Flow Prediction Engine',
      subtitle:
        'Deterministic 7, 30, and 90-day projections modeled from open invoices, customer delay history, and scheduled payouts.',
      explainAi: 'Explain with Gemini AI',
      analyzing: 'Analyzing...',
    },
    copilot: {
      title: 'AI Financial Copilot',
      subtitle:
        "Ask working-capital questions grounded exclusively in your workspace's verified records.",
      askButton: 'Ask Copilot',
      analyzing: 'Analyzing Ledger...',
      readOnly: 'Read-only · Never modifies ledger',
      suggestedLabel: 'Suggested Questions:',
      placeholder: 'Ask about 30-day cash runway, overdue invoices, affordability, or expenses...',
    },
  },
  kn: {
    nav: {
      admin: 'ಪ್ಲಾಟ್‌ಫಾರ್ಮ್ ಆಡಳಿತ',
      dashboard: 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
      invoices: 'ಸ್ಮಾರ್ಟ್ ಇನ್‌ವಾಯ್ಸ್‌ಗಳು',
      recovery: 'ಪಾವತಿ ವಸೂಲಾತಿ',
      forecast: 'ನಗದು ಮುನ್ಸೂಚನೆ',
      customers: 'ಗ್ರಾಹಕರು ಮತ್ತು ಅಪಾಯ',
      expenses: 'ವೆಚ್ಚಗಳು',
      copilot: 'AI ಕೋಪೈಲಟ್',
      reports: 'ವರದಿಗಳು',
      billing: 'ಯೋಜನೆಗಳು ಮತ್ತು ಬಿಲ್ಲಿಂಗ್',
      settings: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
    },
    header: {
      createInvoice: 'ಇನ್‌ವಾಯ್ಸ್ ರಚಿಸಿ',
      signedInAs: 'ಲಾಗಿನ್ ಆದವರು',
      signOut: 'ಸೈನ್ ಔಟ್',
      simulatedDemo: 'ಸಿಮ್ಯುಲೇಟೆಡ್ ಡೆಮೊ',
      planSuffix: 'ಯೋಜನೆ',
    },
    recovery: {
      title: 'AI ಪಾವತಿ ವಸೂಲಾತಿ ಸಹಾಯಕ',
      subtitle:
        'ಬಾಕಿ ಇರುವ ಇನ್‌ವಾಯ್ಸ್‌ಗಳನ್ನು ಪರಿಶೀಲಿಸಿ, ಗ್ರಾಹಕರ ವಿಳಂಬ ಮಾದರಿಗಳನ್ನು ವಿಶ್ಲೇಷಿಸಿ ಮತ್ತು ಕನ್ನಡದಲ್ಲಿ ಗೌರವಯುತ ಜ್ಞಾಪನೆಗಳನ್ನು ಕಳುಹಿಸಿ.',
      stageLabel: 'ಜ್ಞಾಪನೆ ಹಂತ',
      generateAi: 'Gemini AI ಮೂಲಕ ರಚಿಸಿ',
      drafting: 'ರಚಿಸಲಾಗುತ್ತಿದೆ...',
      loadTemplate: 'ಪ್ರಮಾಣಿತ ಟೆಂಪ್ಲೇಟ್ ಲೋಡ್ ಮಾಡಿ',
    },
    forecast: {
      title: 'ನಗದು ಹರಿವು ಮುನ್ಸೂಚನೆ ಎಂಜಿನ್',
      subtitle:
        'ಬಾಕಿ ಇನ್‌ವಾಯ್ಸ್‌ಗಳು, ಗ್ರಾಹಕರ ಪಾವತಿ ಇತಿಹಾಸ ಮತ್ತು ನಿಗದಿತ ವೆಚ್ಚಗಳಿಂದ 7, 30 ಮತ್ತು 90-ದಿನಗಳ ಮುನ್ಸೂಚನೆ.',
      explainAi: 'Gemini AI ಮೂಲಕ ವಿವರಿಸಿ',
      analyzing: 'ವಿಶ್ಲೇಷಿಸಲಾಗುತ್ತಿದೆ...',
    },
    copilot: {
      title: 'AI ಹಣಕಾಸು ಕೋಪೈಲಟ್',
      subtitle:
        'ನಿಮ್ಮ ಕಾರ್ಯಸ್ಥಳದ ಪರಿಶೀಲಿಸಿದ ಲೆಡ್ಜರ್ ದಾಖಲೆಗಳ ಆಧಾರದ ಮೇಲೆ ಕನ್ನಡದಲ್ಲಿ ಕಾರ್ಯನಿರ್ವಹಣಾ ಬಂಡವಾಳ ಪ್ರಶ್ನೆಗಳನ್ನು ಕೇಳಿ.',
      askButton: 'ಕೋಪೈಲಟ್ ಕೇಳಿ',
      analyzing: 'ಲೆಡ್ಜರ್ ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ...',
      readOnly: 'ಓದಲು ಮಾತ್ರ · ಲೆಡ್ಜರ್ ಬದಲಾಯಿಸುವುದಿಲ್ಲ',
      suggestedLabel: 'ಸೂಚಿಸಲಾದ ಪ್ರಶ್ನೆಗಳು:',
      placeholder: '30-ದಿನದ ನಗದು, ಬಾಕಿ ಇನ್‌ವಾಯ್ಸ್‌ಗಳು ಅಥವಾ ವೆಚ್ಚಗಳ ಬಗ್ಗೆ ಕೇಳಿ...',
    },
  },
  hi: {
    nav: {
      admin: 'प्लेटफ़ॉर्म एडमिन',
      dashboard: 'डैशबोर्ड',
      invoices: 'स्मार्ट इनवॉइस',
      recovery: 'भुगतान रिकवरी',
      forecast: 'कैश पूर्वानुमान',
      customers: 'ग्राहक और जोखिम',
      expenses: 'खर्च',
      copilot: 'AI कोपायलट',
      reports: 'रिपोर्ट्स',
      billing: 'प्लान और बिलिंग',
      settings: 'सेटिंग्स',
    },
    header: {
      createInvoice: 'नया इनवॉइस बनाएं',
      signedInAs: 'लॉग इन उपयोगकर्ता',
      signOut: 'साइन आउट',
      simulatedDemo: 'सिम्युलेटेड डेमो',
      planSuffix: 'प्लान',
    },
    recovery: {
      title: 'AI भुगतान रिकवरी सहायक',
      subtitle:
        'बकाया इनवॉइस की समीक्षा करें, ग्राहक भुगतान देरी पैटर्न देखें, और हिन्दी में विनम्र अनुस्मारक भेजें।',
      stageLabel: 'अनुस्मारक चरण',
      generateAi: 'Gemini AI से लिखें',
      drafting: 'तैयार किया जा रहा है...',
      loadTemplate: 'मानक टेम्पलेट लोड करें',
    },
    forecast: {
      title: 'कैश फ्लो पूर्वानुमान इंजन',
      subtitle:
        'खुले इनवॉइस, ग्राहक भुगतान इतिहास और आगामी खर्चों के आधार पर 7, 30 और 90-दिनों का सटीक पूर्वानुमान।',
      explainAi: 'Gemini AI से समझाएं',
      analyzing: 'विश्लेषण हो रहा है...',
    },
    copilot: {
      title: 'AI वित्तीय कोपायलट',
      subtitle:
        'अपने कार्यक्षेत्र के सत्यापित बहीखाता रिकॉर्ड के आधार पर हिन्दी में वर्किंग कैपिटल प्रश्न पूछें।',
      askButton: 'कोपायलट से पूछें',
      analyzing: 'खाता जांच रहा है...',
      readOnly: 'केवल पढ़ने हेतु · बहीखाता नहीं बदलता',
      suggestedLabel: 'सुझाए गए प्रश्न:',
      placeholder: '30-दिन के कैश, बकाया इनवॉइस या खर्च के बारे में पूछें...',
    },
  },
};
