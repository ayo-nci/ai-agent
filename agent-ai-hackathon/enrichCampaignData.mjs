const parseLLMOutput = (llmString = '') => {
 const formatted = llmString.replace(/###/g, '\n###').trim();
 const sections = {
   confirmed: {},
   missing: [],
   questions: []
 };

 const confirmedMatch = llmString.match(/### Confirmed Details\n([\s\S]*?)(?=###|$)/);
 if (confirmedMatch) {
   const details = confirmedMatch[1].split('\n-').filter(Boolean);
   details.forEach(detail => {
     const [key, value] = detail.split(':').map(s => s?.trim() || '');
     if (key) {
       sections.confirmed[key.toLowerCase()] = value || '';
     }
   });
 }

 const missingMatch = llmString.match(/### Missing Critical Info\n([\s\S]*?)(?=###|$)/);
 if (missingMatch) {
   sections.missing = missingMatch[1].split('\n-')
     .filter(Boolean)
     .map(item => item?.trim() || '');
 }

 const questionsMatch = llmString.match(/### Follow-up Questions\n([\s\S]*?)(?=###|$)/);
 if (questionsMatch) {
   sections.questions = questionsMatch[1].split('\n')
     .filter(q => /^\d+\./.test(q))
     .map(q => q.replace(/^\d+\.\s*/, '').trim() || '');
 }

 return { display: formatted, data: sections };
};

const parseFollowUpAnswers = (jsonString = '') => {
 try {
   const data = JSON.parse(jsonString);
   return {
     objectives: {
       growth: parseInt(data?.objectives?.growth_target) || 0,
       channels: data?.objectives?.channels || []
     },
     competition: {
       count: data?.competition?.number_of_competitors || 0,
       type: data?.competition?.competitor_type || '',
       platforms: data?.competition?.competitor_channels || []
     },
     platforms: {
       preferred: [...(data?.platforms?.primary_channels || []), ...(data?.platforms?.secondary_channels || [])],
       budget: {
         meta_google: parseInt(data?.platforms?.budget_split?.meta_google) || 0, 
         radio: parseInt(data?.platforms?.budget_split?.radio) || 0
       }
     },
     historical: {
       peakDates: {
         full: data?.historical?.peak_period || '',
         start: data?.historical?.peak_period?.split('-')[0] || '',
         end: data?.historical?.peak_period?.split('-')[1] || ''
       },
       avgOrder: data?.historical?.average_order_value || 0,
       metrics: {
         ctr: parseFloat(data?.historical?.facebook_metrics?.ctr) || 0,
         cpc: data?.historical?.facebook_metrics?.cpc || 0,
         bestFormat: data?.historical?.facebook_metrics?.best_format || ''
       }
     },
     targeting: {
       income: data?.targeting?.household_income || '',
       type: data?.targeting?.customer_type || ''
     },
     assets: {
       existing: data?.assets?.available || [],
       needed: data?.assets?.needed || [],
       budget: data?.assets?.video_budget || 0
     },
     goals: {
       storeVisits: data?.goals?.store_visits || 0,
       totalSales: data?.goals?.total_sales || 0,
       split: {
         inStore: parseInt(data?.goals?.sales_split?.in_store) || 0,
         online: parseInt(data?.goals?.sales_split?.online) || 0
       }
     }
   };
 } catch (error) {
   return {};
 }
};

const enrichCampaignData = async (event, context) => {
 try {
   const body = event?.body ? JSON.parse(event.body) : {};
   const agentContext = body.context ?? {};

   const initialParse = parseLLMOutput(agentContext.ai_parse_user_input_);
   const followUpParse = parseFollowUpAnswers(agentContext.parsed_follow_up_user_input);

   const input = {
     location: initialParse?.data?.confirmed?.location || '',
     target: {
       age: initialParse?.data?.confirmed?.target?.split(',')[1]?.trim() || '',
       gender: initialParse.data?.confirmed?.target?.split(',')[0]?.trim() || '',
       income: followUpParse?.targeting?.income || '',
       type: followUpParse?.targeting?.type || ''
     },
     timing: {
       start: followUpParse?.historical?.peakDates.start || '',
       end: followUpParse?.historical?.peakDates.end || ''
     },
     product: initialParse?.data?.confirmed?.product || '',
     industry: initialParse?.data?.confirmed?.industry || 'retail',
     metrics: {
       ...(followUpParse?.historical?.metrics || {}),
       goals: followUpParse?.goals || {}
     },
     platforms: followUpParse?.platforms || {}
   };

   const enrichedData = {
     demographics: await safeExecute(() => getDemographics(input)),
     trends: await Promise.allSettled([
       safeExecute(() => getGoogleTrends(input)),
       safeExecute(() => getSocialMediaStats(input)),
       safeExecute(() => getWeatherData(input))
     ]).then(results => results.map(r => r.value).filter(Boolean)),
     benchmarks: await safeExecute(() => getAdPlatformData(input)),
     events: await safeExecute(() => getCalendarEvents(input))
   };

   return {
     statusCode: 200,
     body: JSON.stringify({
      enriched_data: enrichedData,
       initialParse:initialParse,
       followUpParse:followUpParse,
       message: "Data enrichment complete",
       
     })
   };

 } catch (error) {
   return {
     statusCode: 500,
     body: JSON.stringify({
       error: error.message || 'Internal server error',
       parsed_input: {},
       enriched_data: {}
     })
   };
 }
};

const safeExecute = async (fn, defaultValue = {}) => {
 try {
   const result = await fn();
   return result || defaultValue;
 } catch {
   return defaultValue;
 }
};

///////////////
const getDemographics = async (input) => ({
 marketSize: await safeExecute(() => ({
   totalPopulation: input?.metrics?.goals?.storeVisits || '',
   targetPopulation: '',
   growthRate: '',
   householdData: {
     avgSize: '',
     income: input?.target?.income || ''
   }
 })),
 income: await safeExecute(() => ({
   median: '',
   brackets: {
     [input?.target?.income || '']: ''
   }
 })),
 relationships: await safeExecute(() => ({
   coupled: input?.target?.type?.includes('relationship') ? '' : '',
   single: ''
 })),
 ageGroups: await safeExecute(() => ({
   [input?.target?.age || '']: '',
   mediaPreferences: {
     social: '',
     search: '',
     display: ''
   }
 }))
});

const getGoogleTrends = async (input) => ({
 relatedQueries: [
   input?.product || '',
   input?.location || '',
   ''
 ].filter(Boolean),
 interestOverTime: [{
   date: input?.timing?.start || '',
   value: input?.metrics?.ctr || ''
 }],
 geoTargets: [input?.location || ''].filter(Boolean)
});

const getSocialMediaStats = async (input) => ({
 meta: {
   audienceSize: input?.metrics?.goals?.storeVisits || '',
   interests: [input?.target?.type || ''],
   peakHours: input?.platforms?.preferred?.includes('meta') ? [] : []
 },
 instagram: {
   hashtags: [
     input?.product || '',
     input?.location || ''
   ].filter(Boolean),
   engagementRate: input?.metrics?.ctr || ''
 }
});

const getWeatherData = async (input) => ({
 forecast: [],
 shoppingImpact: input?.location || '',
 contingencyDates: [input?.timing?.end || '']
});

const getAdPlatformData = async (input) => ({
 cpc: { 
   meta: input?.metrics?.cpc || '',
   google: input?.metrics?.cpc || ''
 },
 conversion: {
   meta: input?.metrics?.ctr || '',
   google: input?.metrics?.ctr || ''
 },
 seasonalMultiplier: '',
 recommendedBudget: {
   daily: input?.metrics?.goals?.totalSales || ''
 }
});

const getCalendarEvents = async (input) => ({
 mainEvent: input?.timing?.start || '',
 related: [],
 commercial: [
   input?.location || '',
   ''
 ].filter(Boolean),
 competitor: input?.platforms?.preferred || []
});

module.exports = { execute: enrichCampaignData };
