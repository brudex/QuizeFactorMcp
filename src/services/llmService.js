import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "../config/config.js";

class LLMService {
  constructor() {
    // Initialize LLM clients based on configuration
    if (config.llm.anthropic.enabled) {
      this.anthropic = new Anthropic({
        apiKey: config.llm.anthropic.apiKey,
        apiVersion: "2023-06-01"
      });
    }

    if (config.llm.openai.enabled) {
      this.openai = new OpenAI({
        apiKey: config.llm.openai.apiKey
      });
    }

    // Validate at least one provider is enabled
    if (!config.llm.anthropic.enabled && !config.llm.openai.enabled) {
      throw new Error("No LLM provider is configured. Please provide either ANTHROPIC_API_KEY or OPENAI_API_KEY in the .env file.");
    }
  }

  async processPrompt(prompt, options = {}) {
    const provider = options.provider || config.llm.defaultProvider;
    const maxTokens = options.maxTokens || 4000;
    const temperature = options.temperature || 0;

    try {
      console.log(`🤖 Using LLM Provider: ${provider}`);
      console.log(`📝 Model: ${provider === "anthropic" ? config.llm.anthropic.model : config.llm.openai.model}`);

      if (provider === "anthropic" && config.llm.anthropic.enabled) {
        return await this.processWithAnthropic(prompt, maxTokens, temperature);
      } else if (provider === "openai" && config.llm.openai.enabled) {
        return await this.processWithOpenAI(prompt, maxTokens, temperature);
      } else {
        // Try fallback if preferred provider is not available
        if (config.llm.anthropic.enabled) {
          console.warn("⚠️ Falling back to Anthropic");
          return await this.processWithAnthropic(prompt, maxTokens, temperature);
        } else if (config.llm.openai.enabled) {
          console.warn("⚠️ Falling back to OpenAI");
          return await this.processWithOpenAI(prompt, maxTokens, temperature);
        } else {
          throw new Error("No LLM provider available");
        }
      }
    } catch (error) {
      console.error("❌ LLM processing error:", error);
      throw error;
    }
  }

  async processWithAnthropic(prompt, maxTokens, temperature) {
    try {
      const response = await this.anthropic.messages.create({
        model: config.llm.anthropic.model,
        max_tokens: maxTokens,
        temperature: temperature,
        messages: [{ role: "user", content: prompt }]
      });

      console.log("✅ Successfully processed with Anthropic");
      return response.content[0].text;
    } catch (error) {
      if (error.status === 429) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }
      throw error;
    }
  }

  async processWithOpenAI(prompt, maxTokens, temperature) {
    try {
      const response = await this.openai.chat.completions.create({
        model: config.llm.openai.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: temperature
      });

      console.log("✅ Successfully processed with OpenAI");
      return response.choices[0].message.content;
    } catch (error) {
      if (error.status === 429) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }
      throw error;
    }
  }

  // Helper method to check if a provider is available
  isProviderAvailable(provider) {
    if (provider === "anthropic") {
      return config.llm.anthropic.enabled;
    } else if (provider === "openai") {
      return config.llm.openai.enabled;
    }
    return false;
  }

  // Get the current active provider
  getActiveProvider() {
    const defaultProvider = config.llm.defaultProvider;
    if (this.isProviderAvailable(defaultProvider)) {
      return defaultProvider;
    }
    // Return first available provider as fallback
    return config.llm.anthropic.enabled ? "anthropic" : 
           config.llm.openai.enabled ? "openai" : null;
  }
}

// Create and export a default instance
const defaultInstance = new LLMService();
export default defaultInstance; 