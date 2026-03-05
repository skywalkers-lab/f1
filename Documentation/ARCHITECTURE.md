# Architecture Design Document for Pitwall Command Center F1 25 UDP Telemetry WPF Application

## Overview
The Pitwall Command Center application is designed to display real-time telemetry data from F1 vehicles using a UDP connection. This document describes the architecture of the application, including its folder structure, class diagrams, design patterns, and data pipeline.

## Folder Structure
```plaintext
PitwallCommandCenter/
├── Assets/                  # Contains images, icons, and other assets
├── Documentation/           # Contains all documentation files
│   ├── ARCHITECTURE.md     # This architecture document
│   └── README.md           # General information about the project
├── Models/                  # Contains data models for telemetry
├── ViewModels/              # MVVM ViewModels
├── Views/                   # XAML files for the WPF application
├── Services/                # Services for network communication, data handling, etc.
└── Utilities/               # Helper functions and extensions
```  

## Class Diagrams
![Class Diagram](path_to_your_class_diagram_image)  
*Include image paths to your diagrams here*

## Design Patterns
1. **Model-View-ViewModel (MVVM)**: This pattern is used to separate the UI logic from the business logic, making it easier to manage and test the code.
2. **Singleton**: The service classes that manage UDP connections can be implemented as singletons to ensure a single instance is used throughout the application.
3. **Observer**: The ViewModels notify the views about updates in telemetry data using the observer pattern.

## Data Pipeline
1. **Data Acquisition**: Telemetry data is received via UDP using the `UdpClient` class.
2. **Data Processing**: The received data is processed and mapped to model classes.
3. **Data Binding**: The processed data is then bound to the ViewModels, which in turn update the views dynamically.
4. **Data Storage**: Optionally, telemetry data may be stored in a local database for further analysis.

## Conclusion
This document outlines the key components and architecture of the Pitwall Command Center application. Further details can be explored in individual documentation files, especially in the README and other architecture-related documents.